///main.js
// initialize Blockly workspace
var workspace = Blockly.inject('blocklyDiv', {
  toolbox: document.getElementById('toolbox'),
  grid: {spacing: 20, length: 1, colour: '#ccc', snap: true},
  zoom: {controls: true, wheel: true, startScale: 0.9},
 
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
// PYTHON TO BLOCKLY PARSER (FINAL CORRECTED VERSION)
// ============================================
class PythonToBlocklyParser {
  constructor(workspace) {
    this.workspace = workspace;
    this.blockStack = []; // Stack to track nested blocks
  }

  // Get indentation level
  getIndent(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  // Parse a single line and create appropriate block
  parseLine(line, lineNumber, lines, currentIndex) {
    const trimmed = line.trim();
    const indent = this.getIndent(line);
    
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('import')) {
      return null;
    }

    let block = null;
    let context = {}; // Holds context for control blocks

    // ===== CONTROL FLOW =====
    if (trimmed.startsWith('if ')) {
      block = this.workspace.newBlock('controls_if');
      let elifCount = 0; let hasElse = false;
      for (let i = currentIndex + 1; i < lines.length; i++) {
        const nextLine = lines[i].trim(); const nextIndent = this.getIndent(lines[i]);
        if (nextIndent < indent && nextLine) break;
        if (nextIndent === indent) {
          if (nextLine.startsWith('elif ')) elifCount++;
          else if (nextLine.startsWith('else:')) { hasElse = true; break; }
        }
      }
      block.elseifCount_ = elifCount; block.elseCount_ = hasElse ? 1 : 0;
      if (typeof block.updateShape_ === 'function') block.updateShape_();
      const condition = trimmed.match(/if\s+(.+):/);
      if (condition) this.parseCondition(block, condition[1], 'IF0');
      context = { indent, type: 'if', elifIndex: 0, currentSection: 'DO0' };
    }
    else if (trimmed.startsWith('elif ') || trimmed.startsWith('else:')) {
      return null; // Handled by the main parse loop
    }
    else if (trimmed.startsWith('while ')) {
      block = this.workspace.newBlock('controls_whileUntil');
      block.setFieldValue('WHILE', 'MODE');
      const condition = trimmed.match(/while\s+(.+):/);
      if (condition) this.parseCondition(block, condition[1], 'BOOL');
      context = { indent, type: 'while' };
    }
    else if (trimmed.match(/for\s+\w+\s+in\s+range\([^,]+,.+\)/)) {
      block = this.workspace.newBlock('controls_for');
      const match = trimmed.match(/for\s+(\w+)\s+in\s+range\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*(?:,\s*([\d.-]+))?\)/);
      if (match) {
        const [, varName, from, to, by] = match;
        block.setFieldValue(varName, 'VAR');
        this.setNumberInput(block, 'FROM', from);
        this.setNumberInput(block, 'TO', to);
        this.setNumberInput(block, 'BY', by || 1);
      }
      context = { indent, type: 'for' };
    }
    else if (trimmed.match(/for\s+\w+\s+in\s+range\([^,]+\)/)) {
      block = this.workspace.newBlock('controls_repeat_ext');
      const match = trimmed.match(/range\(\s*(\d+)\s*\)/);
      if (match) this.setNumberInput(block, 'TIMES', match[1]);
      context = { indent, type: 'repeat' };
    }

    // ===== DRONE COMMANDS and other statements =====
    else if (trimmed === 'filo.takeoff()') block = this.workspace.newBlock('takeoff');
    else if (trimmed === 'filo.land()') block = this.workspace.newBlock('land');
    else if (trimmed === 'filo.stop()') block = this.workspace.newBlock('stop');
    else if (trimmed === 'filo.emergency()') block = this.workspace.newBlock('emergency');
    else if (trimmed.match(/filo\.move_up\((\d+)\)/)) { block = this.workspace.newBlock('up'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST'); }
    else if (trimmed.match(/filo\.move_down\((\d+)\)/)) { block = this.workspace.newBlock('down'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST'); }
    else if (trimmed.match(/filo\.move_forward\((\d+)\)/)) { block = this.workspace.newBlock('forward'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST'); }
    else if (trimmed.match(/filo\.move_back\((\d+)\)/)) { block = this.workspace.newBlock('back'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST'); }
    else if (trimmed.match(/filo\.move_left\((\d+)\)/)) { block = this.workspace.newBlock('left'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST'); }
    else if (trimmed.match(/filo\.move_right\((\d+)\)/)) { block = this.workspace.newBlock('right'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'DIST'); }
    else if (trimmed.match(/filo\.rotate_clockwise\((\d+)\)/)) { block = this.workspace.newBlock('rotate_cw'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'ANGLE'); }
    else if (trimmed.match(/filo\.rotate_counter_clockwise\((\d+)\)/)) { block = this.workspace.newBlock('rotate_ccw'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'ANGLE'); }
    else if (trimmed.match(/filo\.flip\(["']f["']\)/)) block = this.workspace.newBlock('flip_front');
    else if (trimmed.match(/filo\.flip\(["']b["']\)/)) block = this.workspace.newBlock('flip_back');
    else if (trimmed.match(/filo\.flip\(["']l["']\)/)) block = this.workspace.newBlock('flip_left');
    else if (trimmed.match(/filo\.flip\(["']r["']\)/)) block = this.workspace.newBlock('flip_right');
    else if (trimmed.startsWith('time.sleep(')) { const match = trimmed.match(/time\.sleep\((\d+(?:\.\d+)?)\)/); if (match) { block = this.workspace.newBlock('wait_seconds'); block.setFieldValue(match[1], 'SEC'); } }
    else if (trimmed.match(/filo\.set_speed\((\d+)\)/)) { block = this.workspace.newBlock('setspeed'); block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'SPD'); }
    else if (trimmed.match(/filo\.led_breathe\((.+)\)/)) { block = this.workspace.newBlock('led_breathe'); const a = trimmed.match(/\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/); block.setFieldValue(a[1], 'R'); block.setFieldValue(a[2], 'G'); block.setFieldValue(a[3], 'B'); block.setFieldValue(a[4], 'SP'); }
    else if (trimmed.match(/filo\.led_flash\((.+)\)/)) { block = this.workspace.newBlock('led_flash'); const a = trimmed.match(/\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/); block.setFieldValue(a[1], 'R'); block.setFieldValue(a[2], 'G'); block.setFieldValue(a[3], 'B'); block.setFieldValue(a[4], 'SP'); }
    else if (trimmed.match(/filo\.go\((.+)\)/)) { block = this.workspace.newBlock('go'); const a = trimmed.match(/\(([^,]+),([^,]+),([^,]+),([^)]+)\)/); if (a) { block.setFieldValue(a[1].trim(), 'X'); block.setFieldValue(a[2].trim(), 'Y'); block.setFieldValue(a[3].trim(), 'Z'); block.setFieldValue(a[4].trim(), 'SPD'); } }
    else if (trimmed.match(/filo\.curve\((.+)\)/)) { block = this.workspace.newBlock('curve'); const a = trimmed.match(/\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^)]+)\)/); if (a) { block.setFieldValue(a[1].trim(), 'X1'); block.setFieldValue(a[2].trim(), 'Y1'); block.setFieldValue(a[3].trim(), 'Z1'); block.setFieldValue(a[4].trim(), 'X2'); block.setFieldValue(a[5].trim(), 'Y2'); block.setFieldValue(a[6].trim(), 'Z2'); block.setFieldValue(a[7].trim(), 'SPD'); } }
    else if (trimmed.match(/print\(/)) { /* your print logic */ }
    
    if (!block) return null;
    return { block, ...context };
  }

  // Helper: Parse condition
  parseCondition(parentBlock, conditionStr, inputName = 'IF0') {
    const compMatch = conditionStr.match(/(.+?)\s*(==|!=|<|>|<=|>=)\s*(.+)/);
    if (compMatch) {
      const [, left, op, right] = compMatch;
      const compareBlock = this.workspace.newBlock('logic_compare');
      const opMap = {'==': 'EQ', '!=': 'NEQ', '<': 'LT', '>': 'GT', '<=': 'LTE', '>=': 'GTE'};
      compareBlock.setFieldValue(opMap[op] || 'EQ', 'OP');
      this.setCompareInput(compareBlock, 'A', left.trim());
      this.setCompareInput(compareBlock, 'B', right.trim());
      compareBlock.initSvg(); compareBlock.render();
      const input = parentBlock.getInput(inputName);
      if (input && input.connection) input.connection.connect(compareBlock.outputConnection);
    }
  }

  // Helper: Set number input
  setNumberInput(block, inputName, value) {
    const input = block.getInput(inputName);
    if (!input || !input.connection) return;
    const numBlock = this.workspace.newBlock('math_number');
    numBlock.setFieldValue(value, 'NUM');
    numBlock.initSvg(); numBlock.render();
    input.connection.connect(numBlock.outputConnection);
  }

  // Helper: Set compare input
  setCompareInput(block, inputName, value) {
    const input = block.getInput(inputName);
    if (!input || !input.connection) return;
    if (!isNaN(value)) {
      this.setNumberInput(block, inputName, value);
    } else if (value.includes('filo.get_battery()')) {
      const sensorBlock = this.workspace.newBlock('battery_level');
      sensorBlock.initSvg(); sensorBlock.render();
      input.connection.connect(sensorBlock.outputConnection);
    }
  }

  // Main parse function
  parse(code) {
    this.workspace.clear();
    this.blockStack = [];
    const lines = code.split('\n');
    let topLevelBlocks = [];
    let lastBlockInSection = {}; 
    let lastTopLevelBlock = null; // ✅ ADDED: Tracker for the last top-level block

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('i = None') || trimmed.trim() === 'pass') return;

      const currentIndent = this.getIndent(line);
      let parentContext = this.blockStack.length > 0 ? this.blockStack[this.blockStack.length - 1] : null;

      if (parentContext && parentContext.type === 'if' && currentIndent === parentContext.indent) {
        if (trimmed.startsWith('elif ')) {
          parentContext.elifIndex++;
          const condition = trimmed.match(/elif\s+(.+):/);
          if (condition) this.parseCondition(parentContext.block, condition[1], `IF${parentContext.elifIndex}`);
          parentContext.currentSection = `DO${parentContext.elifIndex}`;
          return;
        }
        if (trimmed.startsWith('else:')) {
          parentContext.currentSection = 'ELSE';
          return;
        }
      }

      while (this.blockStack.length > 0 && this.blockStack[this.blockStack.length - 1].indent > currentIndent) {
        this.blockStack.pop();
      }

      const parsedResult = this.parseLine(line, i, lines, i);
      if (!parsedResult || !parsedResult.block) return;

      const { block, ...context } = parsedResult;
      block.initSvg();
      block.render();

      parentContext = this.blockStack.length > 0 ? this.blockStack[this.blockStack.length - 1] : null;
      if (parentContext) {
        let inputName = 'DO';
        if (parentContext.type === 'if') inputName = parentContext.currentSection;
        else if (parentContext.block.getInput('STACK')) inputName = 'STACK';
        else if (parentContext.block.getInput('DO0')) inputName = 'DO0';
        
        const sectionKey = `${parentContext.block.id}_${inputName}`;
        const lastBlock = lastBlockInSection[sectionKey];
        if (lastBlock) {
          if(lastBlock.nextConnection) lastBlock.nextConnection.connect(block.previousConnection);
        } else {
          const targetInput = parentContext.block.getInput(inputName);
          if (targetInput && targetInput.connection) targetInput.connection.connect(block.previousConnection);
        }
        lastBlockInSection[sectionKey] = block;
      } else {
        // ✅ FIXED: Connect sequential top-level blocks
        if (lastTopLevelBlock && lastTopLevelBlock.nextConnection) {
            lastTopLevelBlock.nextConnection.connect(block.previousConnection);
        } else {
            // This is the first block in a new stack.
            topLevelBlocks.push(block);
        }
        lastTopLevelBlock = block; // Update the last block for the next iteration.
      }
      
      if (context.type) {
        this.blockStack.push({ block, ...context });
      }
    });

    // ✅ FIXED: Arrange only the TOP block of each stack
    let y = 50;
    topLevelBlocks.forEach(b => {
      // Only move the block if it's not already connected to something above it
      if (!b.previousConnection || !b.previousConnection.isConnected()) {
        b.moveBy(50, y);
        y += b.getHeightWidth().height + Blockly.SNAP_RADIUS * 2; // Space out separate stacks
      }
    });
    
    return topLevelBlocks;
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