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
  }
};