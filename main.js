const { app, BrowserWindow, ipcMain, Notification, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Storage management
function getStorePath() {
  return path.join(app.getPath("userData"), "planner.json");
}

function loadStore() {
  try {
    const data = fs.readFileSync(getStorePath(), "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.log("No existing store found or error reading store:", error.message);
    return null;
  }
}

function saveStore(obj) {
  try {
    const dir = path.dirname(getStorePath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getStorePath(), JSON.stringify(obj, null, 2), "utf8");
    console.log("Store saved successfully to:", getStorePath());
  } catch (error) {
    console.error("Error saving store:", error);
    throw error;
  }
}

// Window state management
function getWindowState() {
  const statePath = path.join(app.getPath("userData"), "window-state.json");
  try {
    const data = fs.readFileSync(statePath, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function saveWindowState(windowState) {
  const statePath = path.join(app.getPath("userData"), "window-state.json");
  try {
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(windowState, null, 2));
  } catch (error) {
    console.error("Error saving window state:", error);
  }
}

// Get optimal window dimensions based on screen size
function getOptimalWindowSize() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  // Calculate responsive dimensions
  const minWidth = 800;
  const minHeight = 600;
  const maxWidth = 1600;
  const maxHeight = 1200;
  
  // Use 80% of screen size but within min/max bounds
  let optimalWidth = Math.min(maxWidth, Math.max(minWidth, Math.floor(screenWidth * 0.8)));
  let optimalHeight = Math.min(maxHeight, Math.max(minHeight, Math.floor(screenHeight * 0.8)));
  
  // Center the window
  const x = Math.floor((screenWidth - optimalWidth) / 2);
  const y = Math.floor((screenHeight - optimalHeight) / 2);
  
  return {
    width: optimalWidth,
    height: optimalHeight,
    x: x,
    y: y,
    minWidth: minWidth,
    minHeight: minHeight
  };
}

let mainWindow;

function createWindow() {
  // Get saved window state or calculate optimal size
  const savedState = getWindowState();
  const optimalSize = getOptimalWindowSize();
  
  // Use saved state if available and valid, otherwise use optimal size
  const windowConfig = {
    width: savedState?.width || optimalSize.width,
    height: savedState?.height || optimalSize.height,
    x: savedState?.x || optimalSize.x,
    y: savedState?.y || optimalSize.y,
    minWidth: optimalSize.minWidth,
    minHeight: optimalSize.minHeight,
    show: false, // Don't show until ready to prevent flash
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: process.platform !== 'darwin' ? path.join(__dirname, 'assets/icon.png') : undefined
  };

  // Ensure window is within screen bounds
  const displays = screen.getAllDisplays();
  const windowInBounds = displays.some(display => {
    const { x, y, width, height } = display.workArea;
    return windowConfig.x >= x && 
           windowConfig.y >= y && 
           windowConfig.x + windowConfig.width <= x + width && 
           windowConfig.y + windowConfig.height <= y + height;
  });

  if (!windowInBounds) {
    windowConfig.x = optimalSize.x;
    windowConfig.y = optimalSize.y;
    windowConfig.width = optimalSize.width;
    windowConfig.height = optimalSize.height;
  }

  mainWindow = new BrowserWindow(windowConfig);

  // Restore maximized state if it was saved
  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  // Load the application
  mainWindow.loadFile("index.html");

  // Show window when ready to prevent flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Focus the window
    if (process.platform === 'darwin') {
      app.dock.show();
    }
    mainWindow.focus();
  });

  // Save window state on changes
  const saveCurrentWindowState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      const windowState = {
        ...bounds,
        isMaximized: mainWindow.isMaximized(),
        isFullScreen: mainWindow.isFullScreen()
      };
      saveWindowState(windowState);
    }
  };

  // Save state on various window events
  mainWindow.on('resize', saveCurrentWindowState);
  mainWindow.on('move', saveCurrentWindowState);
  mainWindow.on('maximize', saveCurrentWindowState);
  mainWindow.on('unmaximize', saveCurrentWindowState);
  mainWindow.on('enter-full-screen', saveCurrentWindowState);
  mainWindow.on('leave-full-screen', saveCurrentWindowState);

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in default browser
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Development tools in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Handle certificate errors (for development)
  mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
    if (process.env.NODE_ENV === 'development') {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });
}

// App event handlers
app.whenReady().then(async () => {
  createWindow();

  // macOS specific: recreate window when dock icon is clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });

  // Handle display changes (monitor plugged/unplugged)
  screen.on('display-metrics-changed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const currentBounds = mainWindow.getBounds();
      const displays = screen.getAllDisplays();
      
      // Check if window is still visible on any display
      const isVisible = displays.some(display => {
        const { x, y, width, height } = display.workArea;
        return currentBounds.x < x + width && 
               currentBounds.x + currentBounds.width > x &&
               currentBounds.y < y + height && 
               currentBounds.y + currentBounds.height > y;
      });

      // If not visible, move to primary display
      if (!isVisible) {
        const optimalSize = getOptimalWindowSize();
        mainWindow.setBounds({
          x: optimalSize.x,
          y: optimalSize.y,
          width: optimalSize.width,
          height: optimalSize.height
        });
      }
    }
  });
});

// Quit application when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, url) => {
    event.preventDefault();
    require('electron').shell.openExternal(url);
  });
});

// IPC handlers
ipcMain.handle("load-store", async () => {
  try {
    const store = loadStore();
    console.log("Store loaded successfully");
    return store;
  } catch (error) {
    console.error("Error loading store:", error);
    throw error;
  }
});

ipcMain.handle("save-store", async (event, payload) => {
  try {
    saveStore(payload);
    return { ok: true, message: "Store saved successfully" };
  } catch (error) {
    console.error("Error saving store:", error);
    return { ok: false, error: error.message };
  }
});

// Notification handler with better error handling
ipcMain.on("notify", (event, { title, body, silent = false }) => {
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: title || "Study Planner",
        body: body || "Notification",
        silent: silent,
        urgency: 'normal'
      });
      
      notification.show();
      
      // Auto-close notification after 5 seconds
      setTimeout(() => {
        if (notification) {
          notification.close();
        }
      }, 5000);
      
    } else {
      console.warn("Notifications not supported on this system");
    }
  } catch (error) {
    console.error("Error showing notification:", error);
  }
});

// Additional IPC handlers for app control
ipcMain.handle("app-version", () => {
  return app.getVersion();
});

ipcMain.handle("get-app-path", (event, pathName) => {
  return app.getPath(pathName);
});

ipcMain.handle("minimize-window", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle("maximize-window", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle("close-window", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  app.quit();
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  app.quit();
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Export for testing
module.exports = { createWindow, loadStore, saveStore };

// -------------------- GEMINI API FUNCTIONS --------------------

function readJSONSafe(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Absolute default paths inside this app folder (dev setup)
const DEFAULT_SCHEDULE_PATH = path.join(__dirname, 'schedule.json');
const DEFAULT_TOPICS_PATH = path.join(__dirname, 'topics.json');

// Get Gemini API key - hardcoded only
function getGeminiApiKey() {
  // Hardcoded API key
  const API_KEY = "AIzaSyC_c8bpwGpjSN2inTdpP_Zj-wGZ_OQkDfw";
  return API_KEY;
}

function getGeminiClient() {
  const apiKey = getGeminiApiKey();
  if (!apiKey || apiKey.length < 10) {
    console.error("Gemini API key is missing or not set properly");
    return null;
  }
  
  try {
    return new GoogleGenerativeAI(apiKey);
  } catch (error) {
    console.error("Failed to create Gemini client:", error);
    return null;
  }
}

function getModelId() {
  // Use the working model that actually works
  return 'models/gemini-2.0-flash';
}

// Generate questions using Gemini API
async function generateQuestionsGemini({ subjectTitle, topicLine, sessionType = 'study' }, attempt = 0) {
  const client = getGeminiClient();
  if (!client) {
    return { error: 'Gemini API key not configured properly. Please check your API key.' };
  }
  
  const generationConfig = {
    temperature: 0.35,
    topP: 0.85,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json'
  };

  // Normalize/interpret session type
  const st = (sessionType || 'study').toLowerCase().replace(/\s+/g, '_');
  const isProblemSolving = ['answer_writing','answer-writing','problem_solving','problem-solving','problem','ps'].includes(st);

  // Determine number of questions based on session type
  const questionCount = isProblemSolving ? 10 : 5;
  const sessionDescription = isProblemSolving ? 
    'problem-solving session with only tough/advanced (Hard or Very Hard) questions' : 
    'study session with Medium and Hard questions (no Easy questions)';

  try {
    const model = client.getGenerativeModel({ model: getModelId(), generationConfig });
    
    const difficultyRule = isProblemSolving
      ? 'Hard, Very Hard (ONLY). Include at least 30% Very Hard.'
      : 'Medium, Hard (NO Easy). At least 60% Hard.';

    const depthGuidance = isProblemSolving
      ? '- Force multi-step, multi-constraint reasoning with multiple equations/inequalities, transformations, or casework.\n- Encourage set-based DILR scenarios, chained arithmetic/number theory in QA, or multi-paragraph inference in VARC.'
      : '- Even Medium items must demand application (no recall). Include 2–3 linked steps with at least two equations/constraints.';

    const lengthGuidance = 'Question body length: ~60–120 words to add healthy pressure; avoid unnecessary verbosity.';

    const prompt = `You are an expert CAT mentor. Generate exactly ${questionCount} long-form, advanced CAT practice questions for: ${subjectTitle} — ${topicLine}.\n\nConstraints:\n- Difficulty levels allowed: ${difficultyRule}\n- Questions must be APPLICATION-LEVEL (multi-step). Use multiple equations/constraints wherever relevant.\n- Target CAT timing: 2–3 minutes per question.\n${lengthGuidance}\n${depthGuidance}\n- Prefer variety in formats (MCQ where applicable for QA/VARC; set/case-based for DILR).\n- Avoid definitional/recall. Prioritize interpretation, modeling, and logical deductions.\n- Each item MUST include: text, marks, difficulty, answer, explanation.\n\nOutput format (strict JSON, no markdown fences):\n[\n  {\n    \"id\": \"q1\",\n    \"text\": \"Complete question body...\",\n    \"marks\": 10,\n    \"difficulty\": \"Medium|Hard|Very Hard\",\n    \"answer\": \"Correct option/value\",\n    \"explanation\": \"3–6 line rationale focusing on the key idea(s) used\"\n  }\n]`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Try to parse JSON response
    function extractJson(t) {
      try { 
        return JSON.parse(t); 
      } catch {}
      
      const match = t.match(/```(?:json)?\n([\s\S]*?)```/i);
      if (match) { 
        try { 
          return JSON.parse(match[1]); 
        } catch {} 
      }
      return null;
    }

    const parsed = extractJson(text);
    const now = Date.now();
    
    // Handle both formats: direct array or object with questions property
    let questionsArray = null;
    if (parsed) {
      if (Array.isArray(parsed)) {
        questionsArray = parsed;
      } else if (Array.isArray(parsed.questions)) {
        questionsArray = parsed.questions;
      }
    }
    
    if (questionsArray) {
      return { 
        questions: questionsArray.map((q, i) => ({ 
          id: q.id || `${now}-${i}`, 
          text: q.text, 
          marks: q.marks || 10,
          difficulty: q.difficulty || (isProblemSolving ? 'Hard' : 'Medium'),
          answer: q.answer,
          explanation: q.explanation
        })) 
      };
    }

    // Fallback parsing
    const lines = text.split('\n').filter(l => l.trim());
    const fallback = lines.slice(0, questionCount).map((l, i) => ({ 
      id: `${now}-${i}`, 
      text: l.replace(/^[-*\d.\s]+/, ''), 
      marks: 10,
      difficulty: isProblemSolving ? 'Hard' : 'Medium'
    }));
    
    return { questions: fallback };

  } catch (err) {
    console.error("Gemini API Error in generateQuestionsGemini:", err);

    // Handle rate limiting with retry
    if (err?.status === 429 && attempt < 2) {
      const retryDelay = err?.errorDetails?.find(d => d['@type']?.includes('RetryInfo'))?.retryDelay;
      const delayMs = retryDelay ? parseInt(retryDelay.replace('s', '')) * 1000 : 2000;
      console.log(`Rate limited. Waiting ${delayMs}ms before retry...`);
      await new Promise(r => setTimeout(r, delayMs));
      return generateQuestionsGemini({ subjectTitle, topicLine, sessionType }, attempt + 1);
    }

    const msg = err?.status === 429 ? 
      'Gemini API quota exceeded. Please try again later.' : 
      `Failed to generate questions: ${err.message || 'Unknown error'}`;
    
    return { error: msg };
  }
}

// Ask Gemini a simple question
async function askGeminiSimple({ subjectTitle, topicLine, text }, attempt = 0) {
  const client = getGeminiClient();
  if (!client) {
    return { error: 'Gemini API key not configured properly. Please check your API key.' };
  }

  try {
    const generationConfig = {
      temperature: 0.35,
      topP: 0.85,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    };
    const model = client.getGenerativeModel({ model: getModelId(), generationConfig });
    const prompt = `Generate 1 long, advanced CAT-level question for ${subjectTitle} — ${topicLine} based on: \"${text}\".\n- Require multi-step application with multiple equations/constraints.\n- Body length ~60–120 words.\n- Difficulty: Hard or Very Hard.\nReturn strict JSON (no markdown fences): {\n  \"question\": {\n    \"text\": \"Question body...\",\n    \"marks\": 10,\n    \"difficulty\": \"Hard|Very Hard\",\n    \"answer\": \"Correct option/value\",\n    \"explanation\": \"3–6 line rationale\"\n  }\n}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text();
    
    // Try to parse JSON response for question
    function extractJson(t) {
      try { 
        return JSON.parse(t); 
      } catch {}
      const m = t.match(/```(?:json)?\n([\s\S]*?)```/i);
      if (m) {
        try { return JSON.parse(m[1]); } catch {}
      }
      return null;
    }
    
    const parsed = extractJson(responseText);
    if (parsed && parsed.question) {
      const difficulty = parsed.question.difficulty || 'Hard';
      const marks = parsed.question.marks || 10;
      const ans = parsed.question.answer ? `\nAnswer: ${parsed.question.answer}` : '';
      const exp = parsed.question.explanation ? `\nWhy: ${parsed.question.explanation}` : '';
      return { reply: `Question: ${parsed.question.text} (${marks} marks, ${difficulty})${ans}${exp}` };
    }
    
    // Fallback to raw text
    return { reply: responseText };

  } catch (err) {
    console.error("Gemini API Error in askGeminiSimple:", err);

    // Handle rate limiting with retry
    if (err?.status === 429 && attempt < 2) {
      const retryDelay = err?.errorDetails?.find(d => d['@type']?.includes('RetryInfo'))?.retryDelay;
      const delayMs = retryDelay ? parseInt(retryDelay.replace('s', '')) * 1000 : 2000;
      console.log(`Rate limited. Waiting ${delayMs}ms before retry...`);
      await new Promise(r => setTimeout(r, delayMs));
      return askGeminiSimple({ subjectTitle, topicLine, text }, attempt + 1);
    }

    const msg = err?.status === 429 ? 
      'Gemini API quota exceeded. Please try again later.' : 
      `Failed to get response: ${err.message || 'Unknown error'}`;
    
    return { error: msg };
  }
}

// -------------------- IPC HANDLERS --------------------

ipcMain.handle('schedule:load', async () => {
  // Allow override via env
  const override = process.env.SCHEDULE_PATH;
  const p = override && fs.existsSync(override) ? override : DEFAULT_SCHEDULE_PATH;
  console.log('Loading schedule from:', p);
  console.log('File exists:', fs.existsSync(p));
  
  const data = readJSONSafe(p, null);
  console.log('Schedule data loaded:', !!data);
  if (data) {
    console.log('Schedule has', data.schedule?.length || 0, 'days');
  }
  
  if (!data) return { error: 'Failed to load schedule.json' };
  
  // Attach absence info
  const storePath = path.join(app.getPath('userData'), 'attendance.json');
  const attendance = readJSONSafe(storePath, { absences: {} });
  return { data, path: p, attendance };
});

ipcMain.handle('topics:load', async () => {
  const override = process.env.TOPICS_PATH;
  const p = override && fs.existsSync(override) ? override : DEFAULT_TOPICS_PATH;
  const data = readJSONSafe(p, null);
  if (!data) return { error: 'Failed to load topics.json' };
  return { data, path: p };
});

ipcMain.handle('attendance:toggleAbsent', async (_evt, payload) => {
  const { date, absent } = payload || {};
  if (!date) return { ok: false, error: 'Missing date' };
  
  const storePath = path.join(app.getPath('userData'), 'attendance.json');
  const attendance = readJSONSafe(storePath, { absences: {} });
  
  if (absent) {
    attendance.absences[date] = true;
  } else {
    delete attendance.absences[date];
  }
  
  try {
    fs.writeFileSync(storePath, JSON.stringify(attendance, null, 2), 'utf-8');
    return { ok: true, attendance };
  } catch (error) {
    console.error('Error saving attendance:', error);
    return { ok: false, error: 'Failed to save attendance' };
  }
});

ipcMain.handle('gemini:generateQuestions', async (_evt, payload) => {
  const { subjectTitle, topicLine, sessionType = 'study' } = payload || {};
  if (!subjectTitle || !topicLine) {
    return { error: 'Missing subject or topic information' };
  }
  
  return await generateQuestionsGemini({ subjectTitle, topicLine, sessionType });
});

ipcMain.handle('gemini:ask', async (_evt, payload) => {
  const { subjectTitle, topicLine, text } = payload || {};
  if (!text || !text.trim()) {
    return { error: 'Empty message' };
  }
  
  return await askGeminiSimple({ 
    subjectTitle: subjectTitle || 'General Studies', 
    topicLine: topicLine || 'General', 
    text: text.trim() 
  });
});

// Environment status for debugging
// Environment status for debugging
ipcMain.handle('env:status', async () => {
  const key = getGeminiApiKey();
  const masked = key && key.length >= 10 ?
    `${key.slice(0, 6)}…(${key.length} chars)` :
    '';

  return {
    hasKey: !!(key && key.length >= 10),
    keyPreview: masked,
    model: getModelId(),
    keySource: 'hardcoded'
  };
});