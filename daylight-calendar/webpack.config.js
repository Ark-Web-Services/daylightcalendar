const path = require('path');

module.exports = {
  mode: 'development',
  entry: './public/script.js',
  output: {
    path: path.resolve(__dirname, 'public/dist'),
    filename: 'bundle.js',
  },
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'),
    },
    port: 8099,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      }
    },
    hot: true,
  },
  // Add necessary module rules and plugins here
};