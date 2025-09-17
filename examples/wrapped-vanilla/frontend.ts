// Simple vanilla JavaScript frontend
const app = {
  init: function(serverData) {
    const root = document.getElementById('root');
    root.innerHTML = `
      <h1>Welcome to Melina!</h1>
      <p>Server data: ${JSON.stringify(serverData, null, 2)}</p>
      <p>This is a vanilla JavaScript example.</p>
    `;
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  if (window.SERVER_DATA) {
    app.init(window.SERVER_DATA);
  }
});