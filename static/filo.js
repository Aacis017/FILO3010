// ============================================
// DRONE CONTROL WITH SAFETY FEATURES
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // State management
    let armed = false;
    let connectionOk = false;
    let lastTelemetryUpdate = Date.now();
    let commandInterval;

    // Joystick state
    const joystickState = {
        roll: 0.0,
        pitch: 0.0,
        yaw: 0.0,
        throttle: -1.0  // Start at minimum
    };

    // ============================================
    // EXPONENTIAL CURVE FOR SMOOTHER CONTROL
    // ============================================
    function applyExpo(value, expo = 0.3) {
        // Applies exponential curve: gentler around center, more responsive at extremes
        return value * (1 - expo + expo * Math.abs(value));
    }

    // ============================================
    // JOYSTICK INITIALIZATION
    // ============================================
    const joystickLeft = nipplejs.create({
        zone: document.getElementById('joystick-left'),
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'white',
        size: 150
    });

    const joystickRight = nipplejs.create({
        zone: document.getElementById('joystick-right'),
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: 'white',
        size: 150
    });

    // LEFT joystick → throttle (Y) + yaw (X)
    joystickLeft.on('move', (evt, data) => {
        joystickState.throttle = applyExpo(-data.vector.y);
        joystickState.yaw = applyExpo(data.vector.x);
    });

    joystickLeft.on('end', () => {
        joystickState.throttle = -1.0;  // Return to minimum
        joystickState.yaw = 0;
    });

    // RIGHT joystick → pitch (Y) + roll (X)
    joystickRight.on('move', (evt, data) => {
        joystickState.pitch = applyExpo(-data.vector.y);
        joystickState.roll = applyExpo(data.vector.x);
    });

    joystickRight.on('end', () => {
        joystickState.pitch = 0;
        joystickState.roll = 0;
    });

    // ============================================
    // COMMAND SENDING (CONTINUOUS)
    // ============================================
    function sendCommand(command) {
        const timeout = setTimeout(() => {
            connectionOk = false;
            updateConnectionStatus();
        }, 500);

        fetch('/joystick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(command)
        })
        .then(res => {
            clearTimeout(timeout);
            if (res.ok) {
                connectionOk = true;
                updateConnectionStatus();
                return res.json();
            } else {
                connectionOk = false;
                throw new Error('Server error');
            }
        })
        .then(data => {
            if (data.status === 'ok' && data.sent) {
                const throttle = data.sent.throttle.toFixed(0);
                document.getElementById('throttle-display').innerText = throttle;
            }
            if (data.telemetry) {
                updateTelemetry(data.telemetry);
            }
        })
        .catch(err => {
            clearTimeout(timeout);
            connectionOk = false;
            updateConnectionStatus();
            console.error('Send failed:', err);
        });
    }

    // ============================================
    // CONTINUOUS COMMAND LOOP (20Hz)
    // ============================================
    function startCommandLoop() {
        if (commandInterval) clearInterval(commandInterval);
        
        commandInterval = setInterval(() => {
            if (armed) {
                sendCommand(joystickState);
            }
        }, 50);  // Send every 50ms = 20Hz
    }

    // Start loop immediately
    startCommandLoop();

    // ============================================
    // ARM / DISARM CONTROLS
    // ============================================
    const armButton = document.getElementById('arm-button');
    const disarmButton = document.getElementById('disarm-button');
    const armedStatus = document.getElementById('armed-status');

    armButton.addEventListener('click', () => {
        // Safety check: throttle must be at minimum
        if (joystickState.throttle > -0.9) {
            showAlert('⚠️ SAFETY: Lower throttle to minimum before arming!', 'warning');
            return;
        }

        if (confirm('⚠️ ARM MOTORS?\n\nMAKE SURE:\n- Drone is on flat surface\n- Area is clear\n- Props are secure\n- Battery is charged')) {
            fetch('/arm', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'ok') {
                    armed = true;
                    armedStatus.innerText = "ARMED";
                    armedStatus.style.color = "#00ff00";
                    armedStatus.style.fontWeight = "bold";
                    armButton.disabled = true;
                    disarmButton.disabled = false;
                    showAlert(data.message, 'success');
                    
                    // Enable screen wake lock
                    enableWakeLock();
                } else {
                    showAlert(data.message, 'error');
                }
            })
            .catch(err => {
                showAlert('Failed to arm: ' + err.message, 'error');
            });
        }
    });

    disarmButton.addEventListener('click', () => {
        fetch('/disarm', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            armed = false;
            armedStatus.innerText = "DISARMED";
            armedStatus.style.color = "#ff0000";
            armedStatus.style.fontWeight = "normal";
            armButton.disabled = false;
            disarmButton.disabled = true;
            showAlert(data.message, 'info');
            
            // Release wake lock
            releaseWakeLock();
        });
    });

    // Initialize button states
    disarmButton.disabled = true;

    // ============================================
    // WAKE LOCK (PREVENT SCREEN SLEEP)
    // ============================================
    let wakeLock = null;

    async function enableWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('🔒 Screen wake lock enabled');
            }
        } catch (err) {
            console.warn('Wake lock not available:', err);
        }
    }

    function releaseWakeLock() {
        if (wakeLock) {
            wakeLock.release();
            wakeLock = null;
            console.log('🔓 Screen wake lock released');
        }
    }

    // ============================================
    // CONNECTION STATUS INDICATOR
    // ============================================
    function updateConnectionStatus() {
        const statusDot = document.getElementById('connection-status');
        if (connectionOk) {
            statusDot.style.backgroundColor = '#00ff00';
            statusDot.title = 'Connected';
        } else {
            statusDot.style.backgroundColor = '#ff0000';
            statusDot.title = 'Disconnected';
        }
    }

    // ============================================
    // TELEMETRY UPDATE
    // ============================================
    function updateTelemetry(telem) {
        lastTelemetryUpdate = Date.now();
        
        // Battery
        const batteryLevel = document.getElementById('battery-level');
        const batteryPercent = telem.battery_percent || 0;
        batteryLevel.textContent = `${batteryPercent}%`;
        
        if (batteryPercent < 20) {
            batteryLevel.style.color = '#ff0000';
            batteryLevel.style.fontWeight = 'bold';
        } else if (batteryPercent < 40) {
            batteryLevel.style.color = '#ffaa00';
        } else {
            batteryLevel.style.color = '#00ff00';
        }
        
        // Voltage
        const voltageDisplay = document.getElementById('voltage-display');
        if (voltageDisplay) {
            voltageDisplay.textContent = (telem.battery_voltage || 0).toFixed(2) + 'V';
        }
        
        // Angles
        document.getElementById('roll-display').textContent = (telem.roll || 0).toFixed(1) + '°';
        document.getElementById('pitch-display').textContent = (telem.pitch || 0).toFixed(1) + '°';
        document.getElementById('yaw-display').textContent = (telem.yaw_rate || 0).toFixed(1) + '°/s';
        
        // Armed status from telemetry
        if (telem.armed !== undefined && telem.armed !== armed) {
            armed = telem.armed;
            armedStatus.innerText = armed ? "ARMED" : "DISARMED";
            armedStatus.style.color = armed ? "#00ff00" : "#ff0000";
            armButton.disabled = armed;
            disarmButton.disabled = !armed;
        }
    }

    // ============================================
    // PERIODIC TELEMETRY REQUEST
    // ============================================
    setInterval(() => {
        fetch('/telemetry')
        .then(res => res.json())
        .then(data => {
            updateTelemetry(data);
            
            // Check if telemetry is stale
            if (Date.now() - lastTelemetryUpdate > 2000) {
                connectionOk = false;
                updateConnectionStatus();
            }
        })
        .catch(err => {
            console.error('Telemetry fetch failed:', err);
            connectionOk = false;
            updateConnectionStatus();
        });
    }, 500);

    // ============================================
    // ALERT SYSTEM
    // ============================================
    function showAlert(message, type = 'info') {
        const alertBox = document.getElementById('alert-box') || createAlertBox();
        alertBox.textContent = message;
        alertBox.className = `alert alert-${type}`;
        alertBox.style.display = 'block';
        
        setTimeout(() => {
            alertBox.style.display = 'none';
        }, 5000);
    }

    function createAlertBox() {
        const alertBox = document.createElement('div');
        alertBox.id = 'alert-box';
        alertBox.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 15px 30px;
            border-radius: 8px;
            font-weight: bold;
            z-index: 9999;
            display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(alertBox);
        return alertBox;
    }

    // Add CSS for alert types
    const style = document.createElement('style');
    style.textContent = `
        .alert-success { background: #00ff00; color: #000; }
        .alert-error { background: #ff0000; color: #fff; }
        .alert-warning { background: #ffaa00; color: #000; }
        .alert-info { background: #00aaff; color: #fff; }
    `;
    document.head.appendChild(style);

    // ============================================
    // EMERGENCY DISARM (DOUBLE TAP SCREEN)
    // ============================================
    let lastTap = 0;
    document.addEventListener('touchstart', (e) => {
        const now = Date.now();
        if (now - lastTap < 300) {
            // Double tap detected
            if (armed) {
                fetch('/disarm', { method: 'POST' });
                showAlert('🚨 EMERGENCY DISARM!', 'error');
            }
        }
        lastTap = now;
    });

    // ============================================
    // VISIBILITY CHANGE HANDLER
    // ============================================
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && armed) {
            showAlert('⚠️ App in background! Be careful!', 'warning');
        }
    });

    // ============================================
    // INITIAL STATUS CHECK
    // ============================================
    fetch('/status')
    .then(res => res.json())
    .then(data => {
        armed = data.armed;
        armedStatus.innerText = armed ? "ARMED" : "DISARMED";
        armedStatus.style.color = armed ? "#00ff00" : "#ff0000";
        armButton.disabled = armed;
        disarmButton.disabled = !armed;
        
        if (data.telemetry) {
            updateTelemetry(data.telemetry);
        }
        
        connectionOk = data.connection === 'connected';
        updateConnectionStatus();
    });

    console.log('🚁 Drone control initialized with safety features');
});