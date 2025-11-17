//main.js
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
// PYTHON TO BLOCKLY PARSER (CORRECTED)
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
  // This function is now a "pure" factory: it creates blocks but does NOT manage the stack.
  parseLine(line, lineNumber, lines, currentIndex) {
    const trimmed = line.trim();
    const indent = this.getIndent(line);
    
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('import')) {
      return null;
    }

    let block = null;

    // ===== CONTROL FLOW =====
    if (trimmed.startsWith('if ')) {
      block = this.workspace.newBlock('controls_if');
      let elifCount = 0;
      let hasElse = false;
      for (let i = currentIndex + 1; i < lines.length; i++) {
        const nextLine = lines[i].trim();
        const nextIndent = this.getIndent(lines[i]);
        if (nextIndent < indent && nextLine) break;
        if (nextIndent === indent) {
          if (nextLine.startsWith('elif ')) elifCount++;
          else if (nextLine.startsWith('else:')) {
            hasElse = true;
            break;
          }
        }
      }
      
      block.elseifCount_ = elifCount;
      block.elseCount_ = hasElse ? 1 : 0;
      if (typeof block.updateShape_ === 'function') {
          block.updateShape_();
      }
      
      const condition = trimmed.match(/if\s+(.+):/);
      if (condition) this.parseCondition(block, condition[1], 'IF0');
      
      // Return the block AND its context for the main loop to handle
      return {
        block, 
        indent, 
        type: 'if',
        elifIndex: 0,
        currentSection: 'DO0'
      };
    }
    
    // Elif/Else are now handled entirely by the main parse loop,
    // so this function doesn't need to return a marker for them.
    if (trimmed.startsWith('elif ') || trimmed.startsWith('else:')) {
        return null; // The main loop handles these as state changes
    }

    // While loop
    else if (trimmed.startsWith('while ')) {
      block = this.workspace.newBlock('controls_whileUntil');
      block.setFieldValue('WHILE', 'MODE');
      const condition = trimmed.match(/while\s+(.+):/);
      if (condition) this.parseCondition(block, condition[1], 'BOOL');
      return { block, indent, type: 'while' };
    }

    // For loop
    else if (trimmed.match(/for\s+\w+\s+in\s+range\(/)) {
      block = this.workspace.newBlock('controls_for');
      const match = trimmed.match(/for\s+(\w+)\s+in\s+range\((\d+)(?:,\s*(\d+))?(?:,\s*(\d+))?\)/);
      if (match) {
        const [, varName, start, end, step] = match;
        block.setFieldValue(varName, 'VAR');
        if (end) {
          this.setNumberInput(block, 'FROM', start);
          this.setNumberInput(block, 'TO', end);
          if (step) this.setNumberInput(block, 'BY', step);
        } else {
          this.setNumberInput(block, 'FROM', 0);
          this.setNumberInput(block, 'TO', start);
        }
      }
      return { block, indent, type: 'for' };
    }

    // Repeat loop (simplified match to avoid conflict with for)
    else if (trimmed.match(/for\s+\w+\s+in\s+range\((\d+)\):/)) {
        if (!trimmed.match(/for\s+\w+\s+in\s+range\(\d+,\s*\d+\)/)) { // ensure it's not a full for loop
            block = this.workspace.newBlock('controls_repeat_ext');
            const times = trimmed.match(/range\((\d+)\)/)[1];
            this.setNumberInput(block, 'TIMES', times);
            return { block, indent, type: 'repeat' };
        }
    }

    // ===== DRONE COMMANDS (and other statements) =====
    else if (trimmed === 'filo.takeoff()') block = this.workspace.newBlock('takeoff');
    else if (trimmed === 'filo.land()') block = this.workspace.newBlock('land');
    else if (trimmed === 'filo.stop()') block = this.workspace.newBlock('stop');
    else if (trimmed === 'filo.emergency()') block = this.workspace.newBlock('emergency');
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
   else if (trimmed.startsWith('time.sleep(')) {
        const match = trimmed.match(/time\.sleep\((\d+(?:\.\d+)?)\)/);
        if (match && match[1]) {
            block = this.workspace.newBlock('wait_seconds');
            block.setFieldValue(match[1], 'SEC');
        }
    }

        // ✅ ADDED THIS BLOCK FOR SET SPEED
    else if (trimmed.match(/filo\.set_speed\((\d+)\)/)) {
      block = this.workspace.newBlock('setspeed');
      block.setFieldValue(trimmed.match(/\((\d+)\)/)[1], 'SPD');
    }

    else if (trimmed.match(/filo\.led_breathe\((.+)\)/)) {
      block = this.workspace.newBlock('led_breathe');
      const args = trimmed.match(/\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
      block.setFieldValue(args[1], 'R');
      block.setFieldValue(args[2], 'G');
      block.setFieldValue(args[3], 'B');
      block.setFieldValue(args[4], 'SP');
    }
    else if (trimmed.match(/filo\.led_flash\((.+)\)/)) {
      block = this.workspace.newBlock('led_flash');
      const args = trimmed.match(/\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
      block.setFieldValue(args[1], 'R');
      block.setFieldValue(args[2], 'G');
      block.setFieldValue(args[3], 'B');
      block.setFieldValue(args[4], 'SP');
    }
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
    // ✅ ADDED THIS BLOCK FOR 'GO TO'
    else if (trimmed.match(/filo\.go\((.+)\)/)) {
      block = this.workspace.newBlock('go');
      // Matches 4 comma-separated numbers
      const args = trimmed.match(/\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
      if (args) {
        block.setFieldValue(args[1].trim(), 'X');
        block.setFieldValue(args[2].trim(), 'Y');
        block.setFieldValue(args[3].trim(), 'Z');
        block.setFieldValue(args[4].trim(), 'SPD');
      }
    }
    
    // ✅ ADDED THIS BLOCK FOR 'CURVE'
    else if (trimmed.match(/filo\.curve\((.+)\)/)) {
      block = this.workspace.newBlock('curve');
      // Matches 7 comma-separated numbers
      const args = trimmed.match(/\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
      if (args) {
        block.setFieldValue(args[1].trim(), 'X1');
        block.setFieldValue(args[2].trim(), 'Y1');
        block.setFieldValue(args[3].trim(), 'Z1');
        block.setFieldValue(args[4].trim(), 'X2');
        block.setFieldValue(args[5].trim(), 'Y2');
        block.setFieldValue(args[6].trim(), 'Z2');
        block.setFieldValue(args[7].trim(), 'SPD');
      }
    }
    
    // ... Add any other 'else if' statements for your other blocks here ...

    return block ? { block } : null; // Return simple blocks with no special context
  }

  // Helper: Parse condition and attach to block
  parseCondition(parentBlock, conditionStr, inputName = 'IF0') {
    const compMatch = conditionStr.match(/(.+?)\s*(==|!=|<|>|<=|>=)\s*(.+)/);
    if (compMatch) {
      const [, left, op, right] = compMatch;
      const compareBlock = this.workspace.newBlock('logic_compare');
      const opMap = {'==': 'EQ', '!=': 'NEQ', '<': 'LT', '>': 'GT', '<=': 'LTE', '>=': 'GTE'};
      compareBlock.setFieldValue(opMap[op] || 'EQ', 'OP');
      this.setCompareInput(compareBlock, 'A', left.trim());
      this.setCompareInput(compareBlock, 'B', right.trim());
      compareBlock.initSvg();
      compareBlock.render();
      const input = parentBlock.getInput(inputName);
      if (input && input.connection) {
        input.connection.connect(compareBlock.outputConnection);
      }
    }
  }

  // Helper: Set number input
  setNumberInput(block, inputName, value) {
    const numBlock = this.workspace.newBlock('math_number');
    numBlock.setFieldValue(value, 'NUM');
    numBlock.initSvg();
    numBlock.render();
    block.getInput(inputName).connection.connect(numBlock.outputConnection);
  }

  // Helper: Set compare input (number or sensor)
  setCompareInput(block, inputName, value) {
    const input = block.getInput(inputName);
    if (!input || !input.connection) return;

    if (!isNaN(value)) {
      this.setNumberInput(block, inputName, value);
    } else if (value.includes('filo.get_battery()')) {
      const sensorBlock = this.workspace.newBlock('battery_level');
      sensorBlock.initSvg();
      sensorBlock.render();
      input.connection.connect(sensorBlock.outputConnection);
    }
  }

  // Main parse function (REWRITTEN FOR CORRECTNESS)
  parse(code) {
    this.workspace.clear();
    this.blockStack = [];
    
    const lines = code.split('\n');
    let topLevelBlocks = [];
    let lastBlockInSection = {}; 

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const currentIndent = this.getIndent(line);
      let parentContext = this.blockStack.length > 0 ? this.blockStack[this.blockStack.length - 1] : null;

      // --- 1. HANDLE ELIF/ELSE STATE CHANGES ---
      // Before doing anything else, check if this line is changing the section of a parent 'if' block.
      if (parentContext && parentContext.type === 'if' && currentIndent === parentContext.indent) {
        if (trimmed.startsWith('elif ')) {
          parentContext.elifIndex++;
          const condition = trimmed.match(/elif\s+(.+):/);
          if (condition) {
            this.parseCondition(parentContext.block, condition[1], `IF${parentContext.elifIndex}`);
          }
          parentContext.currentSection = `DO${parentContext.elifIndex}`;
          return; // State updated, move to the next line
        }
        if (trimmed.startsWith('else:')) {
          parentContext.currentSection = 'ELSE';
          return; // State updated, move to the next line
        }
      }

      // --- 2. HANDLE DEDENTATION (Corrected logic) ---
      // Pop from the stack only when indentation DECREASES.
      while (this.blockStack.length > 0 && this.blockStack[this.blockStack.length - 1].indent > currentIndent) {
        this.blockStack.pop();
      }

      // --- 3. PARSE THE LINE TO CREATE A BLOCK ---
      const parsedResult = this.parseLine(line, i, lines, i);
      if (!parsedResult || !parsedResult.block) {
        return; // Skip if no block was created (e.g., it was an else line)
      }

      const { block, ...context } = parsedResult;
      block.initSvg();
      block.render();

      // --- 4. CONNECT THE BLOCK ---
      parentContext = this.blockStack.length > 0 ? this.blockStack[this.blockStack.length - 1] : null;
      if (parentContext) {
        let inputName = 'DO'; // Default for loops
        if (parentContext.type === 'if') {
          inputName = parentContext.currentSection;
        } else if (parentContext.block.getInput('STACK')) {
            inputName = 'STACK';
        } else if (parentContext.block.getInput('DO0')) {
            inputName = 'DO0';
        }
        
        const sectionKey = `${parentContext.block.id}_${inputName}`;
        const lastBlock = lastBlockInSection[sectionKey];

        if (lastBlock) { // Already a block in this section
          if(lastBlock.nextConnection) {
            lastBlock.nextConnection.connect(block.previousConnection);
          }
        } else { // First block in this section
          const targetInput = parentContext.block.getInput(inputName);
          if (targetInput && targetInput.connection) {
            targetInput.connection.connect(block.previousConnection);
          }
        }
        lastBlockInSection[sectionKey] = block;

      } else {
        topLevelBlocks.push(block);
      }
      
      // --- 5. PUSH NEW CONTROL BLOCKS ONTO THE STACK ---
      // If the created block starts a new indented section, push it to the stack.
      if (context.type) {
        this.blockStack.push({ block, ...context });
      }
    });

    // Arrange top-level blocks neatly on the workspace
    let y = 50;
    topLevelBlocks.forEach(b => {
      b.moveBy(50, y);
      y += b.getHeightWidth().height + Blockly.SNAP_RADIUS * 2;
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