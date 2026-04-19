const path = require('path');

module.exports = {
  mode: 'development',
  entry: './public/script.js',
  output: {
    path: path.resolve(__dirname, 'public/dist'),
    filename: 'bundle.js',
  },
  // Simple config that just builds the bundle without starting a separate server
  resolve: {
    extensions: ['.js', '.json'],
  },
  watchOptions: {
    ignored: /node_modules/,
    poll: 1000,
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'),
    },
    compress: true,
    port: 8098,
    host: '0.0.0.0', // allow external connections
    allowedHosts: 'all',
    client: {
      // needed if connecting via exposed port rather than exactly the container's IP
      webSocketURL: 'auto://0.0.0.0:0/ws',
    },
    proxy: {
      '/api': 'http://localhost:3004',
    },
  },
};