const express = require('express');
const { phpVersionsHandler } = require('../handlers/php');
const { nginxConfigGetHandler, nginxConfigPutHandler } = require('../handlers/nginxConfig');
const {
  listSitesHandler,
  createSiteHandler,
  updateSiteHandler,
  deleteSiteHandler,
  toggleSiteHandler,
  sslSiteHandler,
} = require('../handlers/sites');
const { uploadMiddleware, fileRouter } = require('../handlers/files');

const router = express.Router();

router.get('/php-versions', phpVersionsHandler);
router.get('/nginx/config', nginxConfigGetHandler);
router.put('/nginx/config', nginxConfigPutHandler);

router.get('/sites', listSitesHandler);
router.post('/sites', createSiteHandler);
router.put('/sites/:id', updateSiteHandler);
router.delete('/sites/:id', deleteSiteHandler);
router.all('/sites/:id/toggle', toggleSiteHandler);
router.all('/sites/:id/ssl', sslSiteHandler);

router.get('/sites/:id/files', (req, res) => fileRouter(req, res, 'list'));
router.post(
  '/sites/:id/files/upload',
  uploadMiddleware.single('file'),
  (req, res) => fileRouter(req, res, 'upload')
);
router.all('/sites/:id/files/:action', fileRouter);

module.exports = router;
