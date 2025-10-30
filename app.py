from flask import Flask, Response, render_template, request, jsonify
import io, os, json, time, threading, serial, platform

app = Flask(__name__)
armed = False

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
    "battery_voltage": 0.0,
    "battery_percent": 0,
    "armed": False,
    "altitude": 0.0,
    "connection": "disconnected"
}

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
    global joystick_state, armed, last_command_time
    try:
        if not armed:
            return jsonify({"status": "error", "message": "Motors are disarmed"}), 403

        data = request.get_json(force=True)
        last_command_time = time.time()

        # Update state
        for key in data:
            if key in joystick_state:
                joystick_state[key] = float(data[key])

        # Apply conversions
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
    global armed
    joystick_state["throttle"] = -1.0

    
    # Safety check: throttle must be at minimum
    if joystick_state["throttle"] > -0.9:
        return jsonify({
            "status": "error",
            "message": "⚠️ Throttle must be at MINIMUM before arming!"
        }), 400
    
    # Request Arduino to arm
    if arduino:
        arduino.write(b"ARM\n")
        time.sleep(0.1)
        
    armed = True
    telemetry["armed"] = True
    
    return jsonify({
        "status": "ok",
        "message": "🟢 Motors ARMED - BE CAREFUL!"
    })

@app.route('/disarm', methods=['POST'])
def disarm():
    global armed
    armed = False
    telemetry["armed"] = False
    
    if arduino:
        arduino.write(b"DISARM\n")
    
    joystick_state["throttle"] = -1.0
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
        "telemetry": telemetry,
        "connection": "connected" if arduino else "disconnected"
    })

# -------------------------
# Background thread to read serial data
# -------------------------
def read_from_arduino():
    global telemetry, armed
    if not arduino:
        return
    
    while True:
        try:
            raw_line = arduino.readline()
            if raw_line:
                line = raw_line.decode("utf-8", errors="ignore").strip()
                if line:
                    # Parse telemetry: TELEM,roll,pitch,yaw_rate,throttle,voltage,battery%,armed,FL,FR,RL,RR
                    if line.startswith("TELEM,"):
                        parts = line.split(',')
                        if len(parts) >= 8:
                            telemetry["roll"] = float(parts[1])
                            telemetry["pitch"] = float(parts[2])
                            telemetry["yaw_rate"] = float(parts[3])
                            telemetry["battery_voltage"] = float(parts[5])
                            telemetry["battery_percent"] = int(float(parts[6]))
                            telemetry["armed"] = parts[7] == "1"
                            telemetry["connection"] = "connected"
                            
                    elif line.startswith("ACK,"):
                        print(f"✅ {line}")
                        telemetry["connection"] = "connected"
                        
                    elif line.startswith("🚨"):
                        print(f"⚠️ ALERT: {line}")
                        armed = False
                        telemetry["armed"] = False
                        
                    elif line.startswith("STATUS,"):
                        parts = line.split(',')
                        if len(parts) >= 4:
                            telemetry["armed"] = parts[1] == "ARMED"
                            telemetry["battery_voltage"] = float(parts[2])
                            telemetry["roll"] = float(parts[3])
                            telemetry["pitch"] = float(parts[4])
                            
                    else:
                        print(f"📡 {line}")
                        
        except Exception as e:
            print("⚠️ Serial read error:", e)
            telemetry["connection"] = "error"
            time.sleep(1)
            
        time.sleep(0.02)

# Start background thread
if arduino:
    thread = threading.Thread(target=read_from_arduino, daemon=True)
    thread.start()

# -------------------------
# Connection watchdog
# -------------------------
def connection_watchdog():
    global last_command_time, armed, telemetry
    while True:
        time.sleep(0.5)
        if armed and (time.time() - last_command_time > 2):
            print("⚠️ No commands from client, connection may be lost")
            telemetry["connection"] = "warning"

watchdog_thread = threading.Thread(target=connection_watchdog, daemon=True)
watchdog_thread.start()

# -------------------------
# Run Flask app
# -------------------------
if __name__ == '__main__':
    print("\n" + "="*50)
    print("🚁 DRONE CONTROL SERVER")
    print("="*50)
    print("📱 Open on your phone: http://<raspberry-pi-ip>:5000/filo")
    print("🔒 Safety features enabled")
    print("⚠️  ALWAYS test in safe environment!")
    print("="*50 + "\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)