//Initialize Blockly
var workspace = Blockly.inject('blocklyDiv', {
  toolbox: document.getElementById('toolbox'),
  grid: {spacing: 20, length: 1, colour: '#ccc', snap: true},
  zoom: {controls: true, wheel: true}
});

// Initialize CodeMirror
var editor = CodeMirror.fromTextArea(document.getElementById("codeEditor"), {
    mode: "python",
    theme: "darcula",
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    autofocus: true
});

// Generate Python code from Blockly blocks
document.getElementById('generateBtn').addEventListener('click', function() {
  const code = python.pythonGenerator.workspaceToCode(workspace);
  console.log("Generated code:", code);
  editor.setValue(code);
});

// Load blocks back into workspace from Python code
document.getElementById('loadBlocks').addEventListener('click', function() {
  const code = editor.getValue().trim();
  workspace.clear();
  
  if (!code) {
    alert("No code to load!");
    return;
  }
  
  // Parse Python code line by line
  const lines = code.split('\n').filter(line => line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('import'));
  
  let yPos = 50;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    let block = null;
    
    // Simple movement blocks
    if (trimmed === 'filo.takeoff()') block = workspace.newBlock('takeoff');
    else if (trimmed === 'filo.land()') block = workspace.newBlock('land');
    else if (trimmed === 'filo.stop()') block = workspace.newBlock('stop');
    else if (trimmed === 'filo.emergency()') block = workspace.newBlock('emergency');
    
    // Movement with distance
    else if (trimmed.match(/filo\.move_up\((\d+)\)/)) {
      block = workspace.newBlock('up');
      const dist = trimmed.match(/\((\d+)\)/)[1];
      block.setFieldValue(dist, 'DIST');
    }
    else if (trimmed.match(/filo\.move_down\((\d+)\)/)) {
      block = workspace.newBlock('down');
      const dist = trimmed.match(/\((\d+)\)/)[1];
      block.setFieldValue(dist, 'DIST');
    }
    else if (trimmed.match(/filo\.move_forward\((\d+)\)/)) {
      block = workspace.newBlock('forward');
      const dist = trimmed.match(/\((\d+)\)/)[1];
      block.setFieldValue(dist, 'DIST');
    }
    else if (trimmed.match(/filo\.move_back\((\d+)\)/)) {
      block = workspace.newBlock('back');
      const dist = trimmed.match(/\((\d+)\)/)[1];
      block.setFieldValue(dist, 'DIST');
    }
    else if (trimmed.match(/filo\.move_left\((\d+)\)/)) {
      block = workspace.newBlock('left');
      const dist = trimmed.match(/\((\d+)\)/)[1];
      block.setFieldValue(dist, 'DIST');
    }
    else if (trimmed.match(/filo\.move_right\((\d+)\)/)) {
      block = workspace.newBlock('right');
      const dist = trimmed.match(/\((\d+)\)/)[1];
      block.setFieldValue(dist, 'DIST');
    }
    
    // Rotation
    else if (trimmed.match(/filo\.rotate_clockwise\((\d+)\)/)) {
      block = workspace.newBlock('rotate_cw');
      const angle = trimmed.match(/\((\d+)\)/)[1];
      block.setFieldValue(angle, 'ANGLE');
    }
    else if (trimmed.match(/filo\.rotate_counter_clockwise\((\d+)\)/)) {
      block = workspace.newBlock('rotate_ccw');
      const angle = trimmed.match(/\((\d+)\)/)[1];
      block.setFieldValue(angle, 'ANGLE');
    }
    
    // Flips
    else if (trimmed.match(/filo\.flip\("f"\)/)) block = workspace.newBlock('flip_front');
    else if (trimmed.match(/filo\.flip\("b"\)/)) block = workspace.newBlock('flip_back');
    else if (trimmed.match(/filo\.flip\("l"\)/)) block = workspace.newBlock('flip_left');
    else if (trimmed.match(/filo\.flip\("r"\)/)) block = workspace.newBlock('flip_right');
    
    // Wait/Sleep
    else if (trimmed.match(/time\.sleep\((\d+(?:\.\d+)?)\)/)) {
      block = workspace.newBlock('wait_seconds');
      const sec = trimmed.match(/\((\d+(?:\.\d+)?)\)/)[1];
      block.setFieldValue(sec, 'SEC');
    }
    
    // LED commands
    else if (trimmed.match(/filo\.led_set_color\("(\w+)"\)/)) {
      block = workspace.newBlock('led_color');
      const color = trimmed.match(/"(\w+)"/)[1];
      block.setFieldValue(color, 'COLOR');
    }
    else if (trimmed.match(/filo\.led_set_rgb\((\d+),\s*(\d+),\s*(\d+)\)/)) {
      block = workspace.newBlock('led_rgb');
      const match = trimmed.match(/\((\d+),\s*(\d+),\s*(\d+)\)/);
      block.setFieldValue(match[1], 'R');
      block.setFieldValue(match[2], 'G');
      block.setFieldValue(match[3], 'B');
    }
    
    if (block) {
      block.initSvg();
      block.render();
      block.moveBy(50, yPos);
      yPos += 50;
    }
  });
  
  alert("Blocks loaded from Python code!");
});

// Centerize button
document.getElementById("centerBtn").addEventListener("click", () => {
  workspace.scrollCenter();
});

// Helper functions for console output
function logConsole(message, type = 'info') {
  const consoleEl = document.getElementById('console');
  const timestamp = new Date().toLocaleTimeString();
  const colors = {
    info: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    success: 'text-blue-400'
  };
  consoleEl.innerHTML += `<div class="${colors[type]}">[${timestamp}] ${message}</div>`;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function updateStatus(status, text) {
  const indicator = document.querySelector('.status-indicator');
  const statusText = document.getElementById('statusText');
  const stopBtn = document.getElementById('stopBtn');
  
  indicator.className = 'status-indicator status-' + status;
  statusText.textContent = text;
  
  if (status === 'executing') {
    stopBtn.classList.remove('hidden');
  } else {
    stopBtn.classList.add('hidden');
  }
}

function updateSafetyBadges(safetyConfig) {
  const badgesEl = document.getElementById('safetyBadges');
  if (!safetyConfig) return;
  
  badgesEl.innerHTML = `
    <span class="safety-badge badge-safe">Max Alt: ${safetyConfig.max_altitude}cm</span>
    <span class="safety-badge badge-safe">Max Dist: ${safetyConfig.max_distance}cm</span>
    <span class="safety-badge badge-warning">Min Battery: ${safetyConfig.min_battery_percent}%</span>
    <span class="safety-badge badge-safe">Max Time: ${safetyConfig.max_flight_time}s</span>
  `;
}

function updateBatteryDisplay(telemetry) {
  const batteryEl = document.getElementById('batteryDisplay');
  if (!telemetry) return;
  
  const percent = telemetry.battery_percent || 0;
  const voltage = telemetry.battery_voltage || 0;
  const color = percent < 30 ? 'text-red-600' : percent < 50 ? 'text-yellow-600' : 'text-green-600';
  
  batteryEl.innerHTML = `<span class="${color}">🔋 ${percent}% (${voltage.toFixed(1)}V)</span>`;
}

// Validate button - check safety before running
document.getElementById('validateBtn').addEventListener('click', function() {
  const hasBlocks = workspace.getAllBlocks(false).length > 0;
  const manualCode = editor.getValue().trim();
  
  let programToSend = '';
  
  if (hasBlocks) {
    programToSend = python.pythonGenerator.workspaceToCode(workspace);
  } else if (manualCode) {
    programToSend = manualCode;
  } else {
    alert("⚠️ Please create blocks or write code first!");
    return;
  }
  
  logConsole("🛡️ Running safety validation...", 'info');
  
  const serverUrl = window.location.hostname === 'localhost' 
    ? 'http://127.0.0.1:5000' 
    : `http://${window.location.hostname}:5000`;
  
  // Dry-run validation
  fetch(`${serverUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: programToSend, validate_only: true })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      logConsole("✅ Safety validation PASSED", 'success');
      if (data.warnings && data.warnings.length > 0) {
        data.warnings.forEach(w => logConsole(w, 'warning'));
      }
      alert("✅ Program is safe to execute!\n\n" + (data.warnings ? "Warnings:\n" + data.warnings.join("\n") : "No warnings"));
    } else {
      logConsole("❌ Safety validation FAILED", 'error');
      if (data.errors) {
        data.errors.forEach(e => logConsole(e, 'error'));
      }
      alert("❌ Program failed safety checks:\n\n" + (data.errors ? data.errors.join("\n") : data.message));
    }
  })
  .catch(err => {
    logConsole(`❌ Validation error: ${err.message}`, 'error');
  });
});

// Start button - sends either Blockly-generated code OR manually written Python code
document.getElementById("startBtn").addEventListener("click", () => {
    const hasBlocks = workspace.getAllBlocks(false).length > 0;
    const manualCode = editor.getValue().trim();
    
    let programToSend = '';
    
    if (hasBlocks) {
      programToSend = python.pythonGenerator.workspaceToCode(workspace);
      logConsole("🤖 Sending Blockly-generated program...", 'info');
    } else if (manualCode) {
      programToSend = manualCode;
      logConsole("📝 Sending manually written code...", 'info');
    } else {
      alert("⚠️ Please create blocks or write code first!");
      return;
    }
    
    // Show safety confirmation
    const confirmed = confirm(
      "🚁 DRONE FLIGHT SAFETY CHECKLIST\n\n" +
      "Before starting, confirm:\n" +
      "✓ Drone is on flat, stable surface\n" +
      "✓ Battery is sufficiently charged\n" +
      "✓ Area is clear of people and obstacles\n" +
      "✓ You have clear view of the drone\n" +
      "✓ Emergency stop is ready\n" +
      "✓ You understand the program behavior\n\n" +
      "Are you ready to start the program?"
    );
    
    if (!confirmed) {
      logConsole("⚠️ Flight cancelled by user", 'warning');
      return;
    }
    
    console.log("Program to send:", programToSend);
    updateStatus('executing', 'Executing...');
    
    const serverUrl = window.location.hostname === 'localhost' 
      ? 'http://127.0.0.1:5000' 
      : `http://${window.location.hostname}:5000`;
    
    fetch(`${serverUrl}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: programToSend })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        logConsole(`✅ ${data.message}`, 'success');
        logConsole(`📋 Executing ${data.commands} commands`, 'info');
        
        // Show warnings if any
        if (data.warnings && data.warnings.length > 0) {
          data.warnings.forEach(w => logConsole(w, 'warning'));
        }
        
        updateStatus('executing', 'Program Running');
        checkProgramStatus();
      } else {
        logConsole(`❌ Error: ${data.message}`, 'error');
        
        // Show all errors
        if (data.errors && data.errors.length > 0) {
          data.errors.forEach(e => logConsole(e, 'error'));
          alert("❌ Safety validation failed:\n\n" + data.errors.join("\n"));
        }
        
        updateStatus('connected', 'Ready');
      }
    })
    .catch(err => {
      console.error("Error:", err);
      logConsole(`❌ Connection error: ${err.message}`, 'error');
      updateStatus('disconnected', 'Connection Failed');
      alert("Failed to connect to server. Make sure:\n1. Server is running\n2. You're on the same network\n3. URL is correct");
    });
});

// Stop button
document.getElementById('stopBtn').addEventListener('click', () => {
  const serverUrl = window.location.hostname === 'localhost' 
    ? 'http://127.0.0.1:5000' 
    : `http://${window.location.hostname}:5000`;
  
  fetch(`${serverUrl}/stop_program`, {
    method: "POST"
  })
  .then(res => res.json())
  .then(data => {
    logConsole('🛑 Program stopped', 'warning');
    updateStatus('connected', 'Ready');
  })
  .catch(err => {
    logConsole(`❌ Stop failed: ${err.message}`, 'error');
  });
});

// Check program status
function checkProgramStatus() {
  const serverUrl = window.location.hostname === 'localhost' 
    ? 'http://127.0.0.1:5000' 
    : `http://${window.location.hostname}:5000`;
  
  const interval = setInterval(() => {
    fetch(`${serverUrl}/status`)
      .then(res => res.json())
      .then(data => {
        if (!data.autonomous) {
          clearInterval(interval);
          logConsole('✅ Program completed', 'success');
          updateStatus('connected', 'Ready');
        }
      })
      .catch(() => {
        clearInterval(interval);
        updateStatus('disconnected', 'Connection Lost');
      });
  }, 1000);
}

// Initial connection check
setTimeout(() => {
  const serverUrl = window.location.hostname === 'localhost' 
    ? 'http://127.0.0.1:5000' 
    : `http://${window.location.hostname}:5000`;
  
  fetch(`${serverUrl}/status`)
    .then(res => res.json())
    .then(data => {
      if (data.connection === 'connected') {
        updateStatus('connected', 'Ready');
        logConsole('✅ Connected to drone server', 'success');
        
        // Update safety badges
        if (data.safety_config) {
          updateSafetyBadges(data.safety_config);
        }
        
        // Update battery display
        if (data.telemetry) {
          updateBatteryDisplay(data.telemetry);
        }
      }
    })
    .catch(() => {
      updateStatus('disconnected', 'Server Offline');
      logConsole('❌ Server not reachable', 'error');
    });
}, 500);

// Periodic telemetry update
setInterval(() => {
  const serverUrl = window.location.hostname === 'localhost' 
    ? 'http://127.0.0.1:5000' 
    : `http://${window.location.hostname}:5000`;
  
  fetch(`${serverUrl}/telemetry`)
    .then(res => res.json())
    .then(data => {
      updateBatteryDisplay(data);
    })
    .catch(() => {
      // Silently fail
    });
}, 2000);