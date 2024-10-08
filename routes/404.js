const router = require('express').Router();

router.get('*', (req, res) => {
    res.render('base', { title: 'Page Not Found', page: '404' });
});

module.exports = router;
