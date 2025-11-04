from flask import Flask, Response, render_template, request, jsonify
import io, os, json, time, threading, serial, platform
import re

app = Flask(__name__)
armed = False
autonomous_mode = False

# ===========================
# SAFETY CONFIGURATION
# ===========================
SAFETY_CONFIG = {
    "max_flight_time": 300,        # 5 minutes max autonomous flight
    "max_altitude": 300,           # 3 meters max (in cm)
    "max_distance": 500,           # 5 meters max per move (in cm)
    "max_rotation": 360,           # Max rotation per command
    "min_battery_percent": 30,     # Min 30% battery
    "max_consecutive_moves": 50,   # Max 50 movement commands
    "require_takeoff_first": True, # Must start with takeoff
    "require_land_last": True,     # Must end with land
    "max_speed": 100,              # Max speed in cm/s
    "geofence_enabled": True,      # Enable virtual boundaries
}

class SafetyValidator:
    """Validates drone programs for safety before execution"""
    
    def __init__(self):
        self.errors = []
        self.warnings = []
        
    def validate_program(self, commands, telemetry):
        """Comprehensive safety validation"""
        self.errors = []
        self.warnings = []
        
        # 1. Check battery
        if telemetry['battery_percent'] < SAFETY_CONFIG['min_battery_percent']:
            self.errors.append(
                f"❌ Battery too low: {telemetry['battery_percent']}% "
                f"(minimum: {SAFETY_CONFIG['min_battery_percent']}%)"
            )
        
        # 2. Check command count
        if len(commands) > SAFETY_CONFIG['max_consecutive_moves']:
            self.errors.append(
                f"❌ Too many commands: {len(commands)} "
                f"(max: {SAFETY_CONFIG['max_consecutive_moves']})"
            )
        
        # 3. Check for takeoff at start
        if SAFETY_CONFIG['require_takeoff_first']:
            if not commands or commands[0]['type'] != 'takeoff':
                self.errors.append("❌ Program must start with TAKEOFF command")
        
        # 4. Check for land at end
        if SAFETY_CONFIG['require_land_last']:
            if not commands or commands[-1]['type'] not in ['land', 'emergency']:
                self.errors.append("❌ Program must end with LAND command")
        
        # 5. Validate total flight time
        total_time = sum(cmd.get('duration', 0) + cmd.get('delay', 0) 
                        for cmd in commands)
        if total_time > SAFETY_CONFIG['max_flight_time']:
            self.errors.append(
                f"❌ Flight time too long: {total_time:.1f}s "
                f"(max: {SAFETY_CONFIG['max_flight_time']}s)"
            )
        
        # 6. Validate individual commands
        altitude = 0  # Track estimated altitude
        total_distance = 0  # Track total travel distance
        
        for i, cmd in enumerate(commands):
            cmd_errors = self._validate_command(cmd, i + 1, altitude)
            self.errors.extend(cmd_errors)
            
            # Update altitude tracking
            if cmd['type'] == 'takeoff':
                altitude = 100  # Assume 1m takeoff
            elif cmd['type'] == 'land':
                altitude = 0
            elif cmd['type'] == 'move':
                # Estimate altitude change
                if cmd.get('throttle', 1400) > 1450:
                    altitude += 20
                elif cmd.get('throttle', 1400) < 1350:
                    altitude -= 20
                
                # Track horizontal distance
                duration = cmd.get('duration', 0)
                speed = 50  # cm/s estimate
                total_distance += duration * speed
        
        # 7. Check total distance
        if total_distance > SAFETY_CONFIG['max_distance'] * 3:
            self.warnings.append(
                f"⚠️ Total distance: {total_distance:.0f}cm - "
                "Ensure adequate space"
            )
        
        # 8. Check altitude safety
        if altitude > SAFETY_CONFIG['max_altitude']:
            self.errors.append(
                f"❌ Estimated max altitude {altitude}cm exceeds "
                f"limit of {SAFETY_CONFIG['max_altitude']}cm"
            )
        
        return len(self.errors) == 0
    
    def _validate_command(self, cmd, cmd_num, current_altitude):
        """Validate individual command"""
        errors = []
        
        # Check movement distances
        if cmd['type'] == 'move':
            duration = cmd.get('duration', 0)
            estimated_dist = duration * 50  # 50cm/s
            
            if estimated_dist > SAFETY_CONFIG['max_distance']:
                errors.append(
                    f"❌ Command {cmd_num}: Distance {estimated_dist:.0f}cm "
                    f"exceeds max {SAFETY_CONFIG['max_distance']}cm"
                )
            
            # Check angles aren't too extreme
            pitch = abs(cmd.get('pitch', 0))
            roll = abs(cmd.get('roll', 0))
            
            if pitch > 30:
                errors.append(
                    f"❌ Command {cmd_num}: Pitch angle {pitch}° too steep (max 30°)"
                )
            if roll > 30:
                errors.append(
                    f"❌ Command {cmd_num}: Roll angle {roll}° too steep (max 30°)"
                )
            
            # Check throttle is reasonable
            throttle = cmd.get('throttle', 1400)
            if throttle > 1800:
                errors.append(
                    f"❌ Command {cmd_num}: Throttle {throttle} too high (max 1800)"
                )
            if throttle < 1100 and current_altitude > 50:
                errors.append(
                    f"⚠️ Command {cmd_num}: Low throttle while airborne"
                )
        
        # Check rotation limits
        if 'yaw' in cmd and abs(cmd['yaw']) > 45:
            errors.append(
                f"❌ Command {cmd_num}: Yaw rate {cmd['yaw']}°/s too high (max 45°/s)"
            )
        
        # Validate duration
        if cmd.get('duration', 0) > 30:
            errors.append(
                f"⚠️ Command {cmd_num}: Duration {cmd['duration']:.1f}s is very long"
            )
        
        return errors
    
    def get_report(self):
        """Get validation report"""
        return {
            "valid": len(self.errors) == 0,
            "errors": self.errors,
            "warnings": self.warnings
        }

validator = SafetyValidator()

# -------------------------
# Arduino serial setup
# -------------------------
try:
    if os.name == "nt":
        arduino = serial.Serial("COM10", 250000, timeout=1)
    else:
        arduino = serial.Serial("/dev/serial0", 250000, timeout=1)
    time.sleep(2)
    arduino.reset_input_buffer()
    print("✅ Arduino connected")
except Exception as e:
    print("❌ Arduino connection failed:", e)
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
        print("📷 Using PiCamera2")
except Exception as e:
    print("⚠️ PiCamera2 not available:", e)
    use_picamera2 = False

if not use_picamera2:
    try:
        import cv2
        camera = cv2.VideoCapture(0)
        print("💻 Using OpenCV webcam")
    except Exception as e:
        print("❌ OpenCV camera error:", e)
        camera = None

# -------------------------
# Telemetry data storage
# -------------------------
telemetry = {
    "roll": 0.0,
    "pitch": 0.0,
    "yaw_rate": 0.0,
    "battery_voltage": 11.1,
    "battery_percent": 50,
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
        self.start_time = None
        
    def parse_and_execute(self, python_code):
        """Parse Python code and convert to Arduino commands"""
        lines = python_code.strip().split('\n')
        commands = []
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#') or line.startswith('import'):
                continue
                
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
        
        # Stop/Hover
        elif 'filo.stop()' in line:
            return {'type': 'hover', 'delay': 1.0}
        
        # Emergency
        elif 'filo.emergency()' in line:
            return {'type': 'emergency', 'delay': 0.0}
        
        # Movement with distance - with safety limits
        elif match := re.search(r'filo\.move_up\((\d+)\)', line):
            dist = min(int(match.group(1)), SAFETY_CONFIG['max_distance'])
            duration = dist / SAFETY_CONFIG['max_speed']
            return {'type': 'move', 'pitch': 0, 'roll': 0, 'throttle': 1500, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_down\((\d+)\)', line):
            dist = min(int(match.group(1)), SAFETY_CONFIG['max_distance'])
            duration = dist / SAFETY_CONFIG['max_speed']
            return {'type': 'move', 'pitch': 0, 'roll': 0, 'throttle': 1300, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_forward\((\d+)\)', line):
            dist = min(int(match.group(1)), SAFETY_CONFIG['max_distance'])
            duration = dist / SAFETY_CONFIG['max_speed']
            return {'type': 'move', 'pitch': 15, 'roll': 0, 'throttle': 1400, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_back\((\d+)\)', line):
            dist = min(int(match.group(1)), SAFETY_CONFIG['max_distance'])
            duration = dist / SAFETY_CONFIG['max_speed']
            return {'type': 'move', 'pitch': -15, 'roll': 0, 'throttle': 1400, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_left\((\d+)\)', line):
            dist = min(int(match.group(1)), SAFETY_CONFIG['max_distance'])
            duration = dist / SAFETY_CONFIG['max_speed']
            return {'type': 'move', 'pitch': 0, 'roll': -15, 'throttle': 1400, 'yaw': 0, 'duration': duration}
        
        elif match := re.search(r'filo\.move_right\((\d+)\)', line):
            dist = min(int(match.group(1)), SAFETY_CONFIG['max_distance'])
            duration = dist / SAFETY_CONFIG['max_speed']
            return {'type': 'move', 'pitch': 0, 'roll': 15, 'throttle': 1400, 'yaw': 0, 'duration': duration}
        
        # Rotation with limits
        elif match := re.search(r'filo\.rotate_clockwise\((\d+)\)', line):
            angle = min(int(match.group(1)), SAFETY_CONFIG['max_rotation'])
            duration = angle / 90.0
            return {'type': 'move', 'pitch': 0, 'roll': 0, 'throttle': 1400, 'yaw': 20, 'duration': duration}
        
        elif match := re.search(r'filo\.rotate_counter_clockwise\((\d+)\)', line):
            angle = min(int(match.group(1)), SAFETY_CONFIG['max_rotation'])
            duration = angle / 90.0
            return {'type': 'move', 'pitch': 0, 'roll': 0, 'throttle': 1400, 'yaw': -20, 'duration': duration}
        
        # Wait/Sleep with limit
        elif match := re.search(r'time\.sleep\((\d+(?:\.\d+)?)\)', line):
            delay = min(float(match.group(1)), 30.0)  # Max 30s wait
            return {'type': 'wait', 'duration': delay}
        
        # LED commands
        elif 'filo.led_' in line:
            return {'type': 'led', 'command': line, 'delay': 0.1}
        
        return None
    
    def execute_commands(self, commands):
        """Execute command sequence with runtime safety checks"""
        self.running = True
        self.start_time = time.time()
        
        for i, cmd in enumerate(commands):
            if not self.running:
                print("❌ Command execution stopped")
                break
            
            # Runtime safety check
            elapsed = time.time() - self.start_time
            if elapsed > SAFETY_CONFIG['max_flight_time']:
                print("❌ Max flight time exceeded - emergency landing")
                self.emergency_land()
                break
            
            # Battery check
            if telemetry['battery_percent'] < 20:
                print("❌ Battery critical - emergency landing")
                self.emergency_land()
                break
            
            print(f"📡 Executing command {i+1}/{len(commands)}: {cmd['type']}")
            
            if cmd['type'] == 'takeoff':
                if not armed:
                    self.arduino.write(b"ARM\n")
                    time.sleep(2)
                
                for throttle in range(1000, 1500, 50):
                    command = f"CMD,0.00,0.00,{throttle:.0f},0.00\n"
                    self.arduino.write(command.encode("utf-8"))
                    time.sleep(0.1)
                
                time.sleep(cmd['delay'])
            
            elif cmd['type'] == 'land':
                for throttle in range(1400, 1000, -50):
                    command = f"CMD,0.00,0.00,{throttle:.0f},0.00\n"
                    self.arduino.write(command.encode("utf-8"))
                    time.sleep(0.1)
                
                self.arduino.write(b"DISARM\n")
                time.sleep(cmd['delay'])
            
            elif cmd['type'] == 'move':
                command = f"CMD,{cmd['roll']:.2f},{cmd['pitch']:.2f},{cmd['throttle']:.0f},{cmd['yaw']:.2f}\n"
                
                steps = int(cmd['duration'] * 20)
                for _ in range(max(1, steps)):
                    # Check for extreme angles during movement
                    if abs(telemetry['roll']) > 45 or abs(telemetry['pitch']) > 45:
                        print("❌ Extreme angle detected - emergency landing")
                        self.emergency_land()
                        return
                    
                    self.arduino.write(command.encode("utf-8"))
                    time.sleep(0.05)
                
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
                print(f"💡 LED: {cmd['command']}")
                time.sleep(cmd['delay'])
        
        self.running = False
        print("✅ Command sequence completed")
    
    def emergency_land(self):
        """Emergency landing procedure"""
        print("🚨 EMERGENCY LANDING")
        for throttle in range(1400, 1000, -100):
            command = f"CMD,0.00,0.00,{throttle:.0f},0.00\n"
            self.arduino.write(command.encode("utf-8"))
            time.sleep(0.2)
        self.arduino.write(b"DISARM\n")
        self.running = False

executor = DroneCommandExecutor(arduino) if arduino else None

# -------------------------
# Blockly program execution endpoint
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
        print("🤖 AUTONOMOUS FLIGHT PROGRAM RECEIVED")
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
        
        print(f"📋 Parsed {len(commands)} commands")
        
        # SAFETY VALIDATION
        print("🛡️ Running safety checks...")
        is_safe = validator.validate_program(commands, telemetry)
        report = validator.get_report()
        
        if not is_safe:
            print("❌ Safety validation FAILED")
            for error in report['errors']:
                print(f"  {error}")
            
            return jsonify({
                "status": "error",
                "message": "Safety validation failed",
                "errors": report['errors'],
                "warnings": report['warnings']
            }), 400
        
        # Show warnings but allow execution
        if report['warnings']:
            print("⚠️ Warnings:")
            for warning in report['warnings']:
                print(f"  {warning}")
        
        print("✅ Safety checks PASSED")
        
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
            "message": f"✅ Executing {len(commands)} commands",
            "commands": len(commands),
            "warnings": report['warnings']
        })
        
    except Exception as e:
        print(f"❌ Error executing program: {e}")
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
        executor.emergency_land()
    
    autonomous_mode = False
    
    return jsonify({
        "status": "success",
        "message": "Program stopped and emergency landing initiated"
    })

@app.route('/safety_config', methods=['GET'])
def get_safety_config():
    """Get current safety configuration"""
    return jsonify(SAFETY_CONFIG)

# -------------------------
# Flask routes (remaining routes same as before)
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
            time.sleep(0.05)
        
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
        "connection": "connected" if arduino else "disconnected",
        "safety_config": SAFETY_CONFIG
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
                            print(f"⚠️ Telemetry parse error: {e}")
                            
                    elif line.startswith("ACK,"):
                        telemetry["connection"] = "connected"
                    
                    elif "Motors ARMED" in line:
                        print(f"✅ {line}")
                        with arm_response_lock:
                            arm_response = "success"
                    
                    elif "Pre-arm checks FAILED" in line or ("❌" in line and "arm" in line.lower()):
                        print(f"❌ {line}")
                        with arm_response_lock:
                            arm_response = "failed"
                    
                    elif line.startswith("🚨") or line.startswith("EMERGENCY"):
                        print(f"⚠️ {line}")
                        armed = False
                        autonomous_mode = False
                        telemetry["armed"] = False
                    
                    else:
                        if len(line) > 0 and not line.startswith('\x00'):
                            print(f"📡 {line}")
                        
        except Exception as e:
            print(f"⚠️ Serial read error: {e}")
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
    print("🚁 SECURE DRONE CONTROL SERVER")
    print("="*50)
    print("📱 Manual Control: http://<ip>:5000/filo")
    print("🤖 Blockly Programming: http://<ip>:5000")
    print("\n🛡️ SAFETY FEATURES ENABLED:")
    print(f"   • Max flight time: {SAFETY_CONFIG['max_flight_time']}s")
    print(f"   • Max altitude: {SAFETY_CONFIG['max_altitude']}cm")
    print(f"   • Max distance per move: {SAFETY_CONFIG['max_distance']}cm")
    print(f"   • Min battery: {SAFETY_CONFIG['min_battery_percent']}%")
    print(f"   • Max commands: {SAFETY_CONFIG['max_consecutive_moves']}")
    print(f"   • Require takeoff first: {SAFETY_CONFIG['require_takeoff_first']}")
    print(f"   • Require land last: {SAFETY_CONFIG['require_land_last']}")
    print("\n⚠️  ALWAYS test in safe environment!")
    print("="*50 + "\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)