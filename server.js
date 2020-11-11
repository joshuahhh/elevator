(async () => {
  const express = require('express');

  const app = express();

  app.enable('trust proxy')  // for herokuapp.com

  let PORT = process.env.PORT;

  if (process.env.NODE_ENV !== 'production') {
    if (!PORT) {
      PORT = await require('portfinder').getPortPromise();
    }
    console.log(`running in development mode: http://localhost:${PORT}/`);

    const config = require('./webpack.config.js');
    const compiler = require('webpack')(config);
    app.use(require('webpack-dev-middleware')(compiler));
    app.use(require('webpack-hot-middleware')(compiler));
  } else {
    if (!PORT) {
      console.error('running in production mode, but no PORT env variable! exiting')
      process.exit(1)
    }
    console.log(`running in production mode on ${PORT}`);
  }

  app.use(express.static('public'));

  app.listen(PORT, function () {
    console.log('app.listen');
  });
})();