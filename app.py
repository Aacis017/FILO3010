from flask import Flask, Response, render_template, request, jsonify
import io, os, json, time, threading, serial, platform
import re

app = Flask(__name__)
armed = False
autonomous_mode = False  # Flag for autonomous flight

# -------------------------
# Arduino serial setup
# -------------------------
try:
    if os.name == "nt":
        arduino = serial.Serial("COM4", 250000, timeout=1)
    else:
        arduino = serial.Serial("/dev/serial0", 250000, timeout=1)
    time.sleep(2)
    arduino.reset_input_buffer()
    print("[OK] Arduino connected")
except Exception as e:
    print("[ERROR] Arduino connection failed:", e)
    arduino = None

# -------------------------
# Camera setup (Auto detect)
# -------------------------
use_picamera2 = False
picam2 = None
camera = None

try:
    if "arm" in platform.machine().lower():
        from picamera2 import Picamera2
        from libcamera import Transform
        picam2 = Picamera2()
        config = picam2.create_video_configuration(
            main={"size": (320, 240)},
            transform=Transform(hflip=1, vflip=1)
        )
        picam2.configure(config)
        picam2.start()
        time.sleep(2)
        use_picamera2 = True
        print("[CAM] Using PiCamera2")
except Exception as e:
    print("[WARN] PiCamera2 not available:", e)
    use_picamera2 = False

if not use_picamera2:
    try:
        import cv2
        camera = cv2.VideoCapture(0)
        print("[CAM] Using OpenCV webcam")
    except Exception as e:
        print("[ERROR] OpenCV camera error:", e)
        camera = None

# -------------------------
# Telemetry data storage
# -------------------------
telemetry = {
    "roll": 0.0,
    "pitch": 0.0,
    "yaw_rate": 0.0,
    "battery_voltage": 0.0,
    "battery_percent": 0,
    "armed": False,
    "altitude": 0.0,
    "connection": "disconnected"
}

arm_response = None
arm_response_lock = threading.Lock()

# -------------------------
# Frame generator
# -------------------------
def generate_frames():
    if use_picamera2 and picam2:
        while True:
            stream = io.BytesIO()
            picam2.capture_file(stream, format="jpeg")
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + stream.getvalue() + b'\r\n')
    elif camera:
        import cv2
        while True:
            success, frame = camera.read()
            if not success:
                continue
            ret, buffer = cv2.imencode('.jpg', frame)
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
    else:
        from PIL import Image
        img = Image.new("RGB", (320, 240), (100, 100, 100))
        while True:
            stream = io.BytesIO()
            img.save(stream, format="JPEG")
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + stream.getvalue() + b'\r\n')

# -------------------------
# Autonomous flight command parser
# -------------------------
class DroneCommandExecutor:
    def __init__(self, arduino_connection):
        self.arduino = arduino_connection
        self.running = False
        
    def parse_and_execute(self, python_code):
        """Parse Python code and convert to Arduino commands"""
        lines = python_code.strip().split('\n')
        commands = []
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#') or line.startswith('import'):
                continue
                
            # Parse filo commands
            cmd = self.parse_command(line)
            if cmd:
                commands.append(cmd)
        
        return commands
    
    def parse_command(self, line):
        """Convert Python filo command to Arduino serial command"""
        
        # Takeoff
        if 'filo.takeoff()' in line:
            return {'type': 'takeoff', 'delay': 3.0}
        
        # Land
        elif 'filo.land()' in line:
            return {'type': 'land', 'delay': 3.0}
        
        # Stop
        elif 'filo.stop()' in line:
            return {'type': 'hover', 'delay': 1.0}
        
        # Emergency
        elif 'filo.emergency()' in line:
            return {'type': 'emergency', 'delay': 0.0}
        
        # Move commands with distance
        elif match := re.search(r'filo\.move_up\((\d+)\)', line):
            dist = int(match.group(1))
            duration = dist / 50.0  # Assume ~50cm/s speed
            return {'type': 'move', 'pitch': 0, 'roll': 0, 'throttle': 1500, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_down\((\d+)\)', line):
            dist = int(match.group(1))
            duration = dist / 50.0
            return {'type': 'move', 'pitch': 0, 'roll': 0, 'throttle': 1300, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_forward\((\d+)\)', line):
            dist = int(match.group(1))
            duration = dist / 50.0
            return {'type': 'move', 'pitch': 15, 'roll': 0, 'throttle': 1400, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_back\((\d+)\)', line):
            dist = int(match.group(1))
            duration = dist / 50.0
            return {'type': 'move', 'pitch': -15, 'roll': 0, 'throttle': 1400, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_left\((\d+)\)', line):
            dist = int(match.group(1))
            duration = dist / 50.0
            return {'type': 'move', 'pitch': 0, 'roll': -15, 'throttle': 1400, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_right\((\d+)\)', line):
            dist = int(match.group(1))
            duration = dist / 50.0
            return {'type': 'move', 'pitch': 0, 'roll': 15, 'throttle': 1400, 'yaw': 0, 'duration': duration}
        
        # Rotate
        elif match := re.search(r'filo\.rotate_clockwise\((\d+)\)', line):
            angle = int(match.group(1))
            duration = angle / 90.0  # Assume 90deg/s rotation
            return {'type': 'move', 'pitch': 0, 'roll': 0, 'throttle': 1400, 'yaw': 20, 'duration': duration}
        
        elif match := re.search(r'filo\.rotate_counter_clockwise\((\d+)\)', line):
            angle = int(match.group(1))
            duration = angle / 90.0
            return {'type': 'move', 'pitch': 0, 'roll': 0, 'throttle': 1400, 'yaw': -20, 'duration': duration}
        
        # Wait/Sleep
        elif match := re.search(r'time\.sleep\((\d+(?:\.\d+)?)\)', line):
            delay = float(match.group(1))
            return {'type': 'wait', 'duration': delay}
        
        # LED commands (placeholder - you'd need to implement on Arduino)
        elif 'filo.led_' in line:
            return {'type': 'led', 'command': line, 'delay': 0.1}
        
        return None
    
    def execute_commands(self, commands):
        """Execute command sequence on Arduino"""
        self.running = True
        
        for i, cmd in enumerate(commands):
            if not self.running:
                print("[X] Command execution stopped")
                break
            
            print(f"[CMD] Executing command {i+1}/{len(commands)}: {cmd['type']}")
            
            if cmd['type'] == 'takeoff':
                # Arm motors first
                if not armed:
                    self.arduino.write(b"ARM\n")
                    time.sleep(2)
                
                # Gradual throttle increase for takeoff
                for throttle in range(1000, 1500, 50):
                    command = f"CMD,0.00,0.00,{throttle:.0f},0.00\n"
                    self.arduino.write(command.encode("utf-8"))
                    time.sleep(0.1)
                
                time.sleep(cmd['delay'])
            
            elif cmd['type'] == 'land':
                # Gradual throttle decrease for landing
                for throttle in range(1400, 1000, -50):
                    command = f"CMD,0.00,0.00,{throttle:.0f},0.00\n"
                    self.arduino.write(command.encode("utf-8"))
                    time.sleep(0.1)
                
                # Disarm
                self.arduino.write(b"DISARM\n")
                time.sleep(cmd['delay'])
            
            elif cmd['type'] == 'move':
                # Send movement command
                command = f"CMD,{cmd['roll']:.2f},{cmd['pitch']:.2f},{cmd['throttle']:.0f},{cmd['yaw']:.2f}\n"
                
                # Send command repeatedly during duration
                steps = int(cmd['duration'] * 20)  # 20Hz update rate
                for _ in range(max(1, steps)):
                    self.arduino.write(command.encode("utf-8"))
                    time.sleep(0.05)
                
                # Return to hover
                hover_cmd = f"CMD,0.00,0.00,{cmd['throttle']:.0f},0.00\n"
                self.arduino.write(hover_cmd.encode("utf-8"))
            
            elif cmd['type'] == 'hover':
                command = f"CMD,0.00,0.00,1400,0.00\n"
                self.arduino.write(command.encode("utf-8"))
                time.sleep(cmd['delay'])
            
            elif cmd['type'] == 'emergency':
                self.arduino.write(b"DISARM\n")
                self.running = False
                break
            
            elif cmd['type'] == 'wait':
                time.sleep(cmd['duration'])
            
            elif cmd['type'] == 'led':
                # LED commands would go here
                print(f"[LED] LED: {cmd['command']}")
                time.sleep(cmd['delay'])
        
        self.running = False
        print("[OK] Command sequence completed")

executor = DroneCommandExecutor(arduino) if arduino else None

# -------------------------
# NEW: Blockly program execution endpoint
# -------------------------
@app.route('/run', methods=['POST'])
def run_program():
    global autonomous_mode
    
    if not arduino:
        return jsonify({
            "status": "error",
            "message": "Arduino not connected"
        }), 500
    
    try:
        data = request.get_json()
        python_code = data.get('code', '')
        
        if not python_code:
            return jsonify({
                "status": "error",
                "message": "No code provided"
            }), 400
        
        print("\n" + "="*50)
        print("[AUTO] AUTONOMOUS FLIGHT PROGRAM RECEIVED")
        print("="*50)
        print(python_code)
        print("="*50 + "\n")
        
        # Parse commands
        commands = executor.parse_and_execute(python_code)
        
        if not commands:
            return jsonify({
                "status": "error",
                "message": "No valid commands found in program"
            }), 400
        
        print(f"[INFO] Parsed {len(commands)} commands")
        
        # Execute in background thread
        autonomous_mode = True
        thread = threading.Thread(
            target=executor.execute_commands,
            args=(commands,),
            daemon=True
        )
        thread.start()
        
        return jsonify({
            "status": "success",
            "message": f"Executing {len(commands)} commands",
            "commands": len(commands)
        })
        
    except Exception as e:
        print(f"[ERROR] Error executing program: {e}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/stop_program', methods=['POST'])
def stop_program():
    """Emergency stop for autonomous flight"""
    global autonomous_mode
    
    if executor:
        executor.running = False
    
    autonomous_mode = False
    
    if arduino:
        arduino.write(b"DISARM\n")
    
    return jsonify({
        "status": "success",
        "message": "Program stopped"
    })

# -------------------------
# Flask routes
# -------------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/filo')
def filo():
    return render_template('filo.html')

# -------------------------
# Joystick state cache
# -------------------------
joystick_state = {
    "roll": 0.0,
    "pitch": 0.0,
    "yaw": 0.0,
    "throttle": -1.0
}

last_command_time = time.time()

@app.route('/joystick', methods=['POST'])
def joystick():
    global joystick_state, armed, last_command_time, autonomous_mode
    
    # Don't accept manual control during autonomous flight
    if autonomous_mode:
        return jsonify({
            "status": "error",
            "message": "Autonomous mode active"
        }), 403
    
    try:
        if not armed:
            return jsonify({"status": "error", "message": "Motors are disarmed"}), 403

        data = request.get_json(force=True)
        last_command_time = time.time()

        for key in data:
            if key in joystick_state:
                joystick_state[key] = float(data[key])

        roll = joystick_state["roll"] * 45
        pitch = joystick_state["pitch"] * 45
        yaw = joystick_state["yaw"] * 45
        throttle_input = -joystick_state["throttle"]
        throttle = 1000 + ((throttle_input + 1) * 500)

        if arduino:
            command = f"CMD,{roll:.2f},{pitch:.2f},{throttle:.0f},{yaw:.2f}\n"
            arduino.write(command.encode("utf-8"))

        return jsonify({
            "status": "ok",
            "sent": {
                "roll": roll,
                "pitch": pitch,
                "yaw": yaw,
                "throttle": throttle
            },
            "telemetry": telemetry
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/arm', methods=['POST'])
def arm():
    global armed, arm_response, autonomous_mode
    
    if autonomous_mode:
        return jsonify({
            "status": "error",
            "message": "Cannot arm during autonomous flight"
        }), 403
    
    if joystick_state["throttle"] > -0.9:
        return jsonify({
            "status": "error",
            "message": "⚠️ Throttle must be at MINIMUM before arming!"
        }), 400
    
    if arduino:
        with arm_response_lock:
            arm_response = None
        
        arduino.write(b"ARM\n")
        start_time = time.time()
        
        while (time.time() - start_time) < 3.0:
            with arm_response_lock:
                if arm_response == "success":
                    armed = True
                    telemetry["armed"] = True
                    return jsonify({
                        "status": "ok",
                        "message": "🟢 Motors ARMED - BE CAREFUL!"
                    })
                elif arm_response == "failed":
                    return jsonify({
                        "status": "error",
                        "message": "❌ Pre-arm checks FAILED!"
                    }), 400
            time.sleep(0.5)
        
        return jsonify({
            "status": "error",
            "message": "⚠️ No response from flight controller"
        }), 500
    else:
        return jsonify({
            "status": "error",
            "message": "❌ Arduino not connected"
        }), 500

@app.route('/disarm', methods=['POST'])
def disarm():
    global armed, autonomous_mode
    armed = False
    autonomous_mode = False
    telemetry["armed"] = False
    
    if arduino:
        arduino.write(b"DISARM\n")
    
    return jsonify({
        "status": "ok",
        "message": "🔴 Motors DISARMED"
    })

@app.route('/telemetry', methods=['GET'])
def get_telemetry():
    return jsonify(telemetry)

@app.route('/status', methods=['GET'])
def get_status():
    if arduino:
        arduino.write(b"STATUS\n")
    return jsonify({
        "armed": armed,
        "autonomous": autonomous_mode,
        "telemetry": telemetry,
        "connection": "connected" if arduino else "disconnected"
    })

# -------------------------
# Background thread to read serial data
# -------------------------
def read_from_arduino():
    global telemetry, armed, arm_response
    if not arduino:
        return
    
    buffer = ""
    
    while True:
        try:
            if arduino.in_waiting:
                raw_data = arduino.read(arduino.in_waiting)
                decoded = raw_data.decode("utf-8", errors="ignore")
                buffer += decoded
                
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    line = line.strip()
                    
                    if not line:
                        continue
                    
                    if line.startswith("TELEM,"):
                        try:
                            parts = line.split(',')
                            if len(parts) >= 8:
                                roll_str = parts[1].strip()
                                pitch_str = parts[2].strip()
                                yaw_str = parts[3].strip()
                                volt_str = parts[5].strip()
                                bat_str = parts[6].strip()
                                
                                if all(c in '0123456789.-' for c in roll_str):
                                    telemetry["roll"] = float(roll_str)
                                if all(c in '0123456789.-' for c in pitch_str):
                                    telemetry["pitch"] = float(pitch_str)
                                if all(c in '0123456789.-' for c in yaw_str):
                                    telemetry["yaw_rate"] = float(yaw_str)
                                if all(c in '0123456789.-' for c in volt_str):
                                    telemetry["battery_voltage"] = float(volt_str)
                                if all(c in '0123456789' for c in bat_str):
                                    telemetry["battery_percent"] = int(float(bat_str))
                                
                                telemetry["armed"] = parts[7].strip() == "1"
                                telemetry["connection"] = "connected"
                        except (ValueError, IndexError) as e:
                            print(f"[WARN] Telemetry parse error: {e}")
                            
                    elif line.startswith("ACK,"):
                        telemetry["connection"] = "connected"
                    
                    elif "Motors ARMED" in line:
                        print(f"[OK] {line}")
                        with arm_response_lock:
                            arm_response = "success"
                    
                    elif "Pre-arm checks FAILED" in line or ("❌" in line and "arm" in line.lower()):
                        print(f"[ERROR] {line}")
                        with arm_response_lock:
                            arm_response = "failed"
                    
                    elif line.startswith("🚨") or line.startswith("EMERGENCY"):
                        print(f"[WARN] {line}")
                        armed = False
                        autonomous_mode = False
                        telemetry["armed"] = False
                    
                    else:
                        if len(line) > 0 and not line.startswith('\x00'):
                            print(f"[DATA] {line}")
                        
        except Exception as e:
            print(f"[WARN] Serial read error: {e}")
            telemetry["connection"] = "error"
            buffer = ""
            time.sleep(1)
            
        time.sleep(0.02)

if arduino:
    thread = threading.Thread(target=read_from_arduino, daemon=True)
    thread.start()

# -------------------------
# Connection watchdog
# -------------------------
def connection_watchdog():
    global last_command_time, armed, telemetry, autonomous_mode
    while True:
        time.sleep(0.5)
        if armed and not autonomous_mode and (time.time() - last_command_time > 2):
            telemetry["connection"] = "warning"

watchdog_thread = threading.Thread(target=connection_watchdog, daemon=True)
watchdog_thread.start()

# -------------------------
# Run Flask app
# -------------------------
if __name__ == '__main__':
    print("\n" + "="*50)
    print("DRONE CONTROL SERVER")
    print("="*50)
    print("Manual Control: http://<ip>:5000/filo")
    print("Blockly Programming: http://<ip>:5000")
    print("Safety features enabled")
    print("ALWAYS test in safe environment!")
    print("="*50 + "\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)