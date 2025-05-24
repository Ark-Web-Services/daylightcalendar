const path = require('path');

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  entry: './public/script.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'public', 'dist'),
    publicPath: '/dist/' // Important for devServer to know where bundled assets are served from
  },
  devtool: process.env.NODE_ENV === 'production' ? 'source-map' : 'inline-source-map',
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'), // Serve files from public directory
    },
    compress: true,
    port: 8099, // Port for webpack-dev-server
    hot: true, // Enable Hot Module Replacement
    open: true, // Open the browser after server had been started
    historyApiFallback: true, // Fallback to index.html for SPA routing
    proxy: {
      '/api': {
        target: 'http://localhost:3001', // Proxy API requests to backend server
        secure: false,
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3001', // Proxy Socket.IO requests
        ws: true // Enable websocket proxying
      }
    }
  },
  // No specific module rules needed for this basic JS/CSS setup if CSS is linked in HTML
  // If you were importing CSS into JS, you'd need css-loader and style-loader here.
};