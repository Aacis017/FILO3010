//main.js

// Initialize Blockly
var workspace = Blockly.inject('blocklyDiv', {
  toolbox: document.getElementById('toolbox'),
  grid: {spacing: 20, length: 1, colour: '#ccc', snap: true},
  zoom: {controls: true, wheel: true, startScale: 0.9}
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

// ============================================
// PYTHON TO BLOCKLY PARSER (ENHANCED)
// ============================================

class PythonToBlocklyParser {
  constructor(workspace) {
    this.workspace = workspace;
    this.blockStack = []; // Stack to track nested blocks
    this.indent_level = 0;
  }

  // Get indentation level
  getIndent(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  // Parse a single line and create appropriate block
  parseLine(line, lineNumber) {
    const trimmed = line.trim();
    const indent = this.getIndent(line);
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('import')) {
      return null;
    }

    let block = null;

    // ===== CONTROL FLOW =====
    
    // If statement
    if (trimmed.startsWith('if ')) {
      block = this.workspace.newBlock('controls_if');
      const condition = trimmed.match(/if\s+(.+):/);
      if (condition) {
        this.parseCondition(block, condition[1]);
      }
      this.blockStack.push({block, indent, type: 'if'});
      return block;
    }

    // While loop
    else if (trimmed.startsWith('while ')) {
      block = this.workspace.newBlock('controls_whileUntil');
      block.setFieldValue('WHILE', 'MODE');
      const condition = trimmed.match(/while\s+(.+):/);
      if (condition) {
        this.parseCondition(block, condition[1], 'BOOL');
      }
      this.blockStack.push({block, indent, type: 'while'});
      return block;
    }

    // For loop
    else if (trimmed.match(/for\s+\w+\s+in\s+range\(/)) {
      block = this.workspace.newBlock('controls_for');
      const match = trimmed.match(/for\s+(\w+)\s+in\s+range\((\d+)(?:,\s*(\d+))?(?:,\s*(\d+))?\)/);
      if (match) {
        const [, varName, start, end, step] = match;
        block.setFieldValue(varName, 'VAR');
        // Set range values
        if (end) {
          this.setNumberInput(block, 'FROM', start);
          this.setNumberInput(block, 'TO', end);
          if (step) this.setNumberInput(block, 'BY', step);
        } else {
          this.setNumberInput(block, 'FROM', 0);
          this.setNumberInput(block, 'TO', start);
        }
      }
      this.blockStack.push({block, indent, type: 'for'});
      return block;
    }

    // Repeat loop
    else if (trimmed.match(/for\s+\w+\s+in\s+range\((\d+)\):/)) {
      block = this.workspace.newBlock('controls_repeat_ext');
      const times = trimmed.match(/range\((\d+)\)/)[1];
      this.setNumberInput(block, 'TIMES', times);
      this.blockStack.push({block, indent, type: 'repeat'});
      return block;
    }

    // ===== DRONE COMMANDS =====
    
    // Simple commands (no parameters)
    else if (trimmed === 'filo.takeoff()') block = this.workspace.newBlock('takeoff');
    else if (trimmed === 'filo.land()') block = this.workspace.newBlock('land');
    else if (trimmed === 'filo.stop()') block = this.workspace.newBlock('stop');
    else if (trimmed === 'filo.emergency()') block = this.workspace.newBlock('emergency');

    // Movement with distance
    else if (trimmed.match(/filo\.move_up\((\d+)\)/)) {
      block = this.workspace.newBlock('up');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST');
    }
    else if (trimmed.match(/filo\.move_down\((\d+)\)/)) {
      block = this.workspace.newBlock('down');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST');
    }
    else if (trimmed.match(/filo\.move_forward\((\d+)\)/)) {
      block = this.workspace.newBlock('forward');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST');
    }
    else if (trimmed.match(/filo\.move_back\((\d+)\)/)) {
      block = this.workspace.newBlock('back');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST');
    }
    else if (trimmed.match(/filo\.move_left\((\d+)\)/)) {
      block = this.workspace.newBlock('left');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST');
    }
    else if (trimmed.match(/filo\.move_right\((\d+)\)/)) {
      block = this.workspace.newBlock('right');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST');
    }

    // Rotation
    else if (trimmed.match(/filo\.rotate_clockwise\((\d+)\)/)) {
      block = this.workspace.newBlock('rotate_cw');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'ANGLE');
    }
    else if (trimmed.match(/filo\.rotate_counter_clockwise\((\d+)\)/)) {
      block = this.workspace.newBlock('rotate_ccw');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'ANGLE');
    }

    // Flips
    else if (trimmed.match(/filo\.flip\(["']f["']\)/)) block = this.workspace.newBlock('flip_front');
    else if (trimmed.match(/filo\.flip\(["']b["']\)/)) block = this.workspace.newBlock('flip_back');
    else if (trimmed.match(/filo\.flip\(["']l["']\)/)) block = this.workspace.newBlock('flip_left');
    else if (trimmed.match(/filo\.flip\(["']r["']\)/)) block = this.workspace.newBlock('flip_right');

    // Wait/Sleep
    else if (trimmed.match(/time\.sleep\((\d+(?:\.\d+)?)\)/)) {
      block = this.workspace.newBlock('wait_seconds');
      block.setFieldValue(trimmed.match(/\((\d+(?:\.\d+)?)\)/)[1], 'SEC');
    }

    // LED Color preset
    else if (trimmed.match(/filo\.led_set_color\(["'](\w+)["']\)/)) {
      block = this.workspace.newBlock('led_color');
      const color = trimmed.match(/["'](\w+)["']/)[1];
      block.setFieldValue(color, 'COLOR');
    }

    // LED RGB
    else if (trimmed.match(/filo\.led_set_rgb\((\d+),\s*(\d+),\s*(\d+)\)/)) {
      block = this.workspace.newBlock('led_rgb');
      const match = trimmed.match(/\((\d+),\s*(\d+),\s*(\d+)\)/);
      block.setFieldValue(match[1], 'R');
      block.setFieldValue(match[2], 'G');
      block.setFieldValue(match[3], 'B');
    }

    // LED Breathe
    else if (trimmed.match(/filo\.led_breathe\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/)) {
      block = this.workspace.newBlock('led_breathe');
      const match = trimmed.match(/\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
      block.setFieldValue(match[1], 'R');
      block.setFieldValue(match[2], 'G');
      block.setFieldValue(match[3], 'B');
      block.setFieldValue(match[4], 'SP');
    }

    // LED Flash
    else if (trimmed.match(/filo\.led_flash\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/)) {
      block = this.workspace.newBlock('led_flash');
      const match = trimmed.match(/\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
      block.setFieldValue(match[1], 'R');
      block.setFieldValue(match[2], 'G');
      block.setFieldValue(match[3], 'B');
      block.setFieldValue(match[4], 'SP');
    }

    // Print statement
    else if (trimmed.match(/print\(/)) {
      block = this.workspace.newBlock('text_print');
      const content = trimmed.match(/print\((.+)\)/);
      if (content) {
        const textBlock = this.workspace.newBlock('text');
        textBlock.setFieldValue(content[1].replace(/['"]/g, ''), 'TEXT');
        textBlock.initSvg();
        textBlock.render();
        block.getInput('TEXT').connection.connect(textBlock.outputConnection);
      }
    }

    return block;
  }

  // Helper: Parse condition and attach to block
  parseCondition(parentBlock, conditionStr, inputName = 'IF0') {
    // Handle comparison operators
    const compMatch = conditionStr.match(/(.+?)\s*(==|!=|<|>|<=|>=)\s*(.+)/);
    if (compMatch) {
      const [, left, op, right] = compMatch;
      const compareBlock = this.workspace.newBlock('logic_compare');
      
      // Map operators
      const opMap = {'==': 'EQ', '!=': 'NEQ', '<': 'LT', '>': 'GT', '<=': 'LTE', '>=': 'GTE'};
      compareBlock.setFieldValue(opMap[op] || 'EQ', 'OP');

      // Set left and right values
      this.setCompareInput(compareBlock, 'A', left.trim());
      this.setCompareInput(compareBlock, 'B', right.trim());

      compareBlock.initSvg();
      compareBlock.render();
      
      const input = parentBlock.getInput(inputName);
      if (input && input.connection) {
        input.connection.connect(compareBlock.outputConnection);
      }
    }
    // Handle boolean values
    else if (conditionStr === 'True' || conditionStr === 'False') {
      const boolBlock = this.workspace.newBlock('logic_boolean');
      boolBlock.setFieldValue(conditionStr === 'True' ? 'TRUE' : 'FALSE', 'BOOL');
      boolBlock.initSvg();
      boolBlock.render();
      
      const input = parentBlock.getInput(inputName);
      if (input && input.connection) {
        input.connection.connect(boolBlock.outputConnection);
      }
    }
  }

  // Helper: Set number input
  setNumberInput(block, inputName, value) {
    const input = block.getInput(inputName);
    if (input && input.connection) {
      const numBlock = this.workspace.newBlock('math_number');
      numBlock.setFieldValue(value, 'NUM');
      numBlock.initSvg();
      numBlock.render();
      input.connection.connect(numBlock.outputConnection);
    }
  }

  // Helper: Set compare input (number or variable)
  setCompareInput(block, inputName, value) {
    const input = block.getInput(inputName);
    if (!input || !input.connection) return;

    if (!isNaN(value)) {
      // It's a number
      const numBlock = this.workspace.newBlock('math_number');
      numBlock.setFieldValue(value, 'NUM');
      numBlock.initSvg();
      numBlock.render();
      input.connection.connect(numBlock.outputConnection);
    } else {
      // It's a variable or sensor
      if (value.includes('filo.get_battery()')) {
        const sensorBlock = this.workspace.newBlock('battery_level');
        sensorBlock.initSvg();
        sensorBlock.render();
        input.connection.connect(sensorBlock.outputConnection);
      } else if (value.includes('filo.get_height()')) {
        const sensorBlock = this.workspace.newBlock('altitude');
        sensorBlock.initSvg();
        sensorBlock.render();
        input.connection.connect(sensorBlock.outputConnection);
      }
    }
  }

  // Main parse function
  parse(code) {
    this.workspace.clear();
    this.blockStack = [];
    
    const lines = code.split('\n');
    const blocks = [];
    let lastBlock = null;
    let lastIndent = 0;

    lines.forEach((line, i) => {
      if (!line.trim() || line.trim().startsWith('#') || line.trim().startsWith('import')) {
        return;
      }

      const currentIndent = this.getIndent(line);
      const block = this.parseLine(line, i);
      
      if (!block) return;

      block.initSvg();
      block.render();

      // Handle indentation (nested blocks)
      if (currentIndent > lastIndent && this.blockStack.length > 0) {
        // This block should go inside the last control block
        const parent = this.blockStack[this.blockStack.length - 1];
        const doInput = parent.block.getInput('DO') || 
                       parent.block.getInput('DO0') ||
                       parent.block.getInput('STACK');
        
        if (doInput && doInput.connection) {
          doInput.connection.connect(block.previousConnection);
          lastBlock = block;
        }
      } 
      else if (currentIndent < lastIndent) {
        // Dedent - pop from stack
        while (this.blockStack.length > 0 && this.blockStack[this.blockStack.length - 1].indent >= currentIndent) {
          this.blockStack.pop();
        }
        
        // Connect to previous block at same level
        if (lastBlock && lastBlock.nextConnection && block.previousConnection) {
          lastBlock.nextConnection.connect(block.previousConnection);
        }
        lastBlock = block;
      }
      else {
        // Same level - connect sequentially
        if (lastBlock && lastBlock.nextConnection && block.previousConnection) {
          lastBlock.nextConnection.connect(block.previousConnection);
        } else {
          // First block - position it
          block.moveBy(50, 50 + blocks.length * 10);
        }
        lastBlock = block;
      }

      blocks.push(block);
      lastIndent = currentIndent;
    });

    return blocks;
  }
}

// ============================================
// UI EVENT HANDLERS
// ============================================

// Generate Python code from Blockly blocks
document.getElementById('generateBtn').addEventListener('click', function() {
  try {
    const code = python.pythonGenerator.workspaceToCode(workspace);
    editor.setValue(code);
    logConsole("✅ Python code generated successfully", 'success');
  } catch (error) {
    logConsole(`❌ Generation error: ${error.message}`, 'error');
  }
});

// Load blocks from Python code
document.getElementById('loadBlocks').addEventListener('click', function() {
  const code = editor.getValue().trim();
  
  if (!code) {
    alert("⚠️ No code to load!");
    return;
  }
  
  try {
    const parser = new PythonToBlocklyParser(workspace);
    const blocks = parser.parse(code);
    
    if (blocks.length > 0) {
      logConsole(`✅ Loaded ${blocks.length} blocks from Python code`, 'success');
      workspace.scrollCenter();
    } else {
      logConsole("⚠️ No valid blocks found in code", 'warning');
    }
  } catch (error) {
    console.error("Parse error:", error);
    logConsole(`❌ Parse error: ${error.message}`, 'error');
    alert(`Failed to parse code:\n${error.message}`);
  }
});

// Center workspace
document.getElementById("centerBtn").addEventListener("click", () => {
  workspace.scrollCenter();
});

// ============================================
// CONSOLE & STATUS HELPERS
// ============================================

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

// ============================================
// PROGRAM EXECUTION
// ============================================

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
        updateStatus('executing', 'Program Running');
        checkProgramStatus();
      } else {
        logConsole(`❌ Error: ${data.message}`, 'error');
        updateStatus('connected', 'Ready');
      }
    })
    .catch(err => {
      logConsole(`❌ Connection error: ${err.message}`, 'error');
      updateStatus('disconnected', 'Connection Failed');
    });
});

// Stop button
document.getElementById('stopBtn').addEventListener('click', () => {
  const serverUrl = window.location.hostname === 'localhost' 
    ? 'http://127.0.0.1:5000' 
    : `http://${window.location.hostname}:5000`;
  
  fetch(`${serverUrl}/stop_program`, { method: "POST" })
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
      }
    })
    .catch(() => {
      updateStatus('disconnected', 'Server Offline');
      logConsole('❌ Server not reachable', 'error');
    });
}, 500);

// Auto-save workspace to localStorage every 30 seconds
setInterval(() => {
  const xml = Blockly.Xml.workspaceToDom(workspace);
  const xmlText = Blockly.Xml.domToText(xml);
  try {
    localStorage.setItem('blockly_workspace', xmlText);
    logConsole('💾 Workspace auto-saved', 'info');
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}, 30000);

// Load workspace on startup
window.addEventListener('load', () => {
  try {
    const savedXml = localStorage.getItem('blockly_workspace');
    if (savedXml) {
      const xml = Blockly.utils.xml.textToDom(savedXml);
      Blockly.Xml.domToWorkspace(xml, workspace);
      logConsole('📂 Previous workspace loaded', 'info');
    }
  } catch (e) {
    console.warn('Failed to load saved workspace:', e);
  }
});