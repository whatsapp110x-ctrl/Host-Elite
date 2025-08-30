export default function DeploymentGuide() {
  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center mb-6">
            <i className="fas fa-book text-blue-brand text-xl mr-3"></i>
            <h1 className="text-2xl font-bold">Deployment Guide</h1>
          </div>

          <div className="space-y-8">
            {/* Python Bots Section */}
            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <i className="fab fa-python text-yellow-400 mr-2"></i>
                Python Bots
              </h2>
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-3">
                <div>
                  <h3 className="font-medium text-slate-200 mb-2">
                    <i className="fas fa-download mr-2 text-green-400"></i>
                    Install: 
                    <code className="bg-slate-800 px-2 py-1 rounded text-sm ml-2">pip install -r requirements.txt</code>
                  </h3>
                </div>
                <div>
                  <h3 className="font-medium text-slate-200 mb-2">
                    <i className="fas fa-play mr-2 text-blue-400"></i>
                    Build: 
                    <code className="bg-slate-800 px-2 py-1 rounded text-sm ml-2">python bot.py</code>
                  </h3>
                </div>
                <div>
                  <h3 className="font-medium text-slate-200 mb-2">
                    <i className="fas fa-terminal mr-2 text-purple-400"></i>
                    Run: 
                    <code className="bg-slate-800 px-2 py-1 rounded text-sm ml-2">python main.py</code>
                  </h3>
                </div>
              </div>
            </div>

            {/* Node.js Bots Section */}
            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <i className="fab fa-node-js text-green-400 mr-2"></i>
                Node.js Bots
              </h2>
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-3">
                <div>
                  <h3 className="font-medium text-slate-200 mb-2">
                    <i className="fas fa-download mr-2 text-green-400"></i>
                    Install: 
                    <code className="bg-slate-800 px-2 py-1 rounded text-sm ml-2">npm install</code>
                  </h3>
                </div>
                <div>
                  <h3 className="font-medium text-slate-200 mb-2">
                    <i className="fas fa-play mr-2 text-blue-400"></i>
                    Build: 
                    <code className="bg-slate-800 px-2 py-1 rounded text-sm ml-2">npm run build</code>
                  </h3>
                </div>
                <div>
                  <h3 className="font-medium text-slate-200 mb-2">
                    <i className="fas fa-terminal mr-2 text-purple-400"></i>
                    Run: 
                    <code className="bg-slate-800 px-2 py-1 rounded text-sm ml-2">npm start</code> or <code className="bg-slate-800 px-2 py-1 rounded text-sm">node index.js</code>
                  </h3>
                </div>
              </div>
            </div>

            {/* Project Structure Examples */}
            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <i className="fas fa-folder-tree text-purple-brand mr-2"></i>
                Project Structure Examples
              </h2>
              
              <div className="grid md:grid-cols-2 gap-6">
                {/* Python Structure */}
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                  <h3 className="font-medium text-slate-200 mb-3 flex items-center">
                    <i className="fab fa-python text-yellow-400 mr-2"></i>
                    Python Bot Structure
                  </h3>
                  <div className="bg-slate-950 rounded p-3 font-mono text-sm text-slate-300">
                    <div>my-bot/</div>
                    <div>├── bot.py</div>
                    <div>├── requirements.txt</div>
                    <div>├── config.py</div>
                    <div>└── handlers/</div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;├── __init__.py</div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;└── commands.py</div>
                  </div>
                </div>

                {/* Node.js Structure */}
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                  <h3 className="font-medium text-slate-200 mb-3 flex items-center">
                    <i className="fab fa-node-js text-green-400 mr-2"></i>
                    Node.js Bot Structure
                  </h3>
                  <div className="bg-slate-950 rounded p-3 font-mono text-sm text-slate-300">
                    <div>my-bot/</div>
                    <div>├── index.js</div>
                    <div>├── package.json</div>
                    <div>├── config.js</div>
                    <div>└── handlers/</div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;├── commands.js</div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;└── events.js</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Requirements Section */}
            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <i className="fas fa-list-check text-green-400 mr-2"></i>
                Requirements
              </h2>
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <ul className="space-y-2 text-slate-300">
                  <li className="flex items-start">
                    <i className="fas fa-check text-green-400 mr-2 mt-1"></i>
                    <span>Your bot must be able to run with a single command (specified in Run Command field)</span>
                  </li>
                  <li className="flex items-start">
                    <i className="fas fa-check text-green-400 mr-2 mt-1"></i>
                    <span>Include all necessary dependencies in requirements.txt (Python) or package.json (Node.js)</span>
                  </li>
                  <li className="flex items-start">
                    <i className="fas fa-check text-green-400 mr-2 mt-1"></i>
                    <span>Bot should handle graceful shutdowns (SIGTERM signals)</span>
                  </li>
                  <li className="flex items-start">
                    <i className="fas fa-check text-green-400 mr-2 mt-1"></i>
                    <span>Maximum ZIP file size is 50MB</span>
                  </li>
                  <li className="flex items-start">
                    <i className="fas fa-check text-green-400 mr-2 mt-1"></i>
                    <span>Use environment variables for sensitive data like API tokens</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Pro Tips Section */}
            <div className="bg-gradient-to-r from-purple-brand/10 to-blue-brand/10 border border-purple-brand/30 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <i className="fas fa-lightbulb text-yellow-400 mr-2"></i>
                Pro Tips
              </h2>
              <div className="text-slate-300 space-y-2">
                <p>• Test your bot locally before deploying to ensure it works correctly</p>
                <p>• Use relative paths in your code since the bot will run from its extracted directory</p>
                <p>• Auto-restart is enabled by default to ensure 24/7 operation</p>
                <p>• Monitor your bot's performance and logs through the real-time dashboard</p>
                <p>• Use the build command for complex setups (compiling, preprocessing, etc.)</p>
                <p>• Keep your bot lightweight for faster deployments and better performance</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
