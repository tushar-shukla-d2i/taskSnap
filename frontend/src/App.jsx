import { useState, useEffect } from "react";
import ImageEditor from "./components/ImageEditor";

function App() {
  const [inputUrl, setInputUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState("");
  const [showEditor, setShowEditor] = useState(false);



  // Helper to format URL
  const formatUrl = (url) => {
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = "https://" + cleanUrl;
    }
    return cleanUrl;
  };

  // Simulate loader steps for a premium experience
  useEffect(() => {
    if (!isLoading) return;

    const steps = [
      "Starting Playwright browser engine...",
      "Launching Chromium in headless mode...",
      "Navigating to the requested website...",
      "Waiting for network resources to load...",
      "Capturing screenshot and rendering layout...",
      "Saving screenshot locally on the server...",
      "Delivering high-resolution image..."
    ];

    setLoadingStep(steps[0]);
    let index = 0;

    const interval = setInterval(() => {
      if (index < steps.length - 1) {
        index++;
        setLoadingStep(steps[index]);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isLoading]);

  // Request screenshot capture from backend
  const handleCapture = async (urlToCapture) => {
    const targetUrl = formatUrl(urlToCapture || inputUrl);
    if (!urlToCapture && !inputUrl) {
      setError("Please enter a website URL first.");
      return;
    }

    setInputUrl(targetUrl);
    setCurrentUrl(targetUrl);
    setIsLoading(true);
    setError("");
    setScreenshotUrl("");
    setShowEditor(false);

    try {
      const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";
      const response = await fetch(`${BACKEND_URL}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl })
      });

      const data = await response.json();

      if (data.success) {
        setScreenshotUrl(data.screenshot);
      } else {
        setError(data.message || "Failed to capture screenshot. The website might be offline or blocked.");
      }
    } catch (err) {
      console.error(err);
      setError("Unable to connect to the backend server. Make sure the backend is running on port 5000.");
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger capture on Enter key
  const handleKeyPress = (e) => {
    if (e.key === "Enter") handleCapture();
  };

  // Custom high-quality download helper
  const downloadScreenshot = async () => {
    if (!screenshotUrl) return;
    try {
      const response = await fetch(screenshotUrl);
      const blob     = await response.blob();
      const blobUrl  = window.URL.createObjectURL(blob);
      const link     = document.createElement("a");
      link.href      = blobUrl;
      const domainName = new URL(currentUrl).hostname.replace("www.", "");
      link.download  = `screenshot-${domainName}-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Download failed:", err);
      window.open(screenshotUrl, "_blank");
    }
  };

  return (
    <>
      <header>
        <div className="logo-container">
          <span className="logo-text">TaskSnap</span>
          <span className="logo-emoji">📸</span>
        </div>
        <h1>Website Screenshot Preview</h1>
        <p className="subtitle">
          Capture high-fidelity, full-page screenshots of any website powered by a headless Playwright instance.
        </p>
      </header>

      <main>
        {/* URL Inputs and Control Section */}
        <section className="glass-card control-panel">
          <div className="input-container">
            <input
              type="text"
              className="url-input"
              placeholder="Enter website URL (e.g. github.com)"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={isLoading}
            />
            <button
              className="capture-btn"
              onClick={() => handleCapture()}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="spinner"></div>
                  Capturing...
                </>
              ) : (
                "Capture"
              )}
            </button>
          </div>



          {error && (
            <div className="error-banner">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
        </section>

        {/* Side-by-Side Workspace Layout */}
        <section className={`workspace ${showEditor ? "editor-open" : ""}`}>
          {/* Left Side: Live Preview Browser Frame */}
          <div className="glass-card browser-panel">
            <div className="browser-chrome">
              <div className="browser-dots">
                <div className="dot red"></div>
                <div className="dot yellow"></div>
                <div className="dot green"></div>
              </div>
              <div className="browser-address-bar">
                <span>🔒 Secure | </span>
                {currentUrl || "https://awaiting-url.local"}
              </div>
            </div>

            <div className="iframe-container">
              {currentUrl ? (
                <iframe
                  src={currentUrl}
                  title="Live Preview"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                />
              ) : (
                <div className="iframe-placeholder">
                  <span className="iframe-placeholder-icon">🌐</span>
                  <h3>Live Website Preview</h3>
                  <p>Enter a website URL above to display its interactive live frame here.</p>
                </div>
              )}
            </div>

            <div className="panel-header" style={{ borderTop: "1px solid var(--card-border)", borderBottom: "none" }}>
              <div className="panel-title" style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                ℹ️ Live preview might be empty if a website blocks iframe loading.
              </div>
              {currentUrl && (
                <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="open-link-btn">
                  Open Site ↗
                </a>
              )}
            </div>
          </div>

          {/* Right Side: Screenshot Panel */}
          <div className="glass-card screenshot-panel">
            <div className="panel-header">
              <div className="panel-title">
                <span>📷</span>
                {" Captured Screenshot"}
              </div>
              <div className="panel-actions">
                {screenshotUrl && (
                  <button
                    className="action-btn edit-open-btn"
                    onClick={() => setShowEditor(true)}
                    title="Open Image Editor"
                  >
                    ✏️ Edit
                  </button>
                )}
                <button
                  className="action-btn"
                  onClick={downloadScreenshot}
                  disabled={!screenshotUrl || isLoading}
                  title="Download Screenshot"
                >
                  📥
                </button>
                <button
                  className="action-btn"
                  onClick={() => window.open(screenshotUrl, "_blank")}
                  disabled={!screenshotUrl || isLoading}
                  title="Open Image in New Tab"
                >
                  🔗
                </button>
              </div>
            </div>

            <div className="screenshot-container">
              {isLoading && (
                <div className="loader-overlay">
                  <div className="loading-dots">
                    <div className="loading-dot"></div>
                    <div className="loading-dot"></div>
                    <div className="loading-dot"></div>
                  </div>
                  <p>Capturing high-resolution viewport...</p>
                  <span className="loading-steps">{loadingStep}</span>
                </div>
              )}

              {/* Plain screenshot preview */}
              {screenshotUrl && !isLoading && (
                <div className="screenshot-img-wrapper">
                  <img
                    src={screenshotUrl}
                    alt="Captured Website View"
                    className="screenshot-img"
                  />
                  {/* Floating "Edit" CTA badge */}
                  <button
                    className="edit-cta-badge"
                    onClick={() => setShowEditor(true)}
                  >
                    ✏️ Open Editor
                  </button>
                </div>
              )}

              {/* Empty state */}
              {!screenshotUrl && !isLoading && (
                <div className="empty-state">
                  <span className="empty-state-icon">📸</span>
                  <h3>Awaiting Snapshot</h3>
                  <p>
                    Click the "Capture" button to spin up a background headless browser and screenshot the site.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Image Editor — Full-screen overlay ── */}
        {showEditor && screenshotUrl && (
          <div className="editor-overlay">
            <div className="overlay-topbar">
              <span className="overlay-title">✏️ Image Editor</span>
              <button className="overlay-close-btn" onClick={() => setShowEditor(false)}>← Back to Preview</button>
            </div>
            <div className="overlay-editor-body">
              <ImageEditor
                imageUrl={screenshotUrl}
                onClose={() => setShowEditor(false)}
              />
            </div>
          </div>
        )}
      </main>

      <footer>
        <p>
          TaskSnap &copy; 2026. Powered by{" "}
          <a href="https://playwright.dev" target="_blank" rel="noreferrer">Playwright</a>,{" "}
          <a href="https://fabricjs.com" target="_blank" rel="noreferrer">Fabric.js</a> and{" "}
          <a href="https://vite.dev" target="_blank" rel="noreferrer">React (Vite)</a>.
        </p>
      </footer>
    </>
  );
}

export default App;
