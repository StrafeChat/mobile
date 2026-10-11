const path = require('path');

const WEB = path.join(__dirname, 'web') + path.sep;

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    overrides: [
      {
        // The shared web sources: Vite's import.meta.env has no meaning here.
        test: (filename) => typeof filename === 'string' && filename.startsWith(WEB),
        plugins: [require('./babel/import-meta-env')],
      },
    ],
  };
};
