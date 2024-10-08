const express = require('express');
const router = express.Router();
const db = require('../config/db');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { isAuthenticated } = require('./middleware');

// View user profile
router.get('/:id', async (req, res) => {
    const userId = req.params.id;

    try {
        const [user] = await db.query(`
            SELECT u.*, c.level AS main_character_level, c.class AS main_character_class, r.name AS role_name
            FROM users u
            LEFT JOIN characters c ON u.main_character = c.name 
            JOIN roles r ON u.role_id = r.id
            WHERE u.id = ?`, [userId]);

        const [characters] = await db.query('SELECT * FROM characters WHERE user_id = ?', [userId]);

        const [professions] = await db.query(`
            SELECT cp.profession_level, p.name, cp.character_id 
            FROM character_professions cp
            JOIN professions p ON cp.profession_id = p.id
            WHERE cp.character_id IN (SELECT id FROM characters WHERE user_id = ?)
        `, [userId]);

        const [availableProfessions] = await db.query('SELECT * FROM professions');

        const [loggedInUserRole] = await db.query(`
            SELECT r.name 
            FROM users u 
            JOIN roles r ON u.role_id = r.id 
            WHERE u.id = ?`, [req.session.userId]);

        if (!user || user.length === 0) {
            res.status(404).render('base', { title: 'User not found', page: '404' });
            return;
        }

        res.render('base', {
            title: `${user[0].username}'s Profile`,
            page: 'profile',
            user: user[0],
            characters,
            professions,
            availableProfessions,
            loggedInUserId: req.session.userId,
            loggedInUserRole: loggedInUserRole[0].name
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/:id/update-profession', async (req, res) => {
    const userId = req.params.id;
    const { character_id, profession_id, profession_level } = req.body;

    if (profession_level < 1 || profession_level > 300) {
        return res.status(400).send('Profession level must be between 1 and 300');
    }

    try {
        const [existingProfession] = await db.query(
            'SELECT * FROM character_professions WHERE character_id = ? AND profession_id = ?',
            [character_id, profession_id]
        );

        if (existingProfession.length > 0) {
            await db.query('UPDATE character_professions SET profession_level = ? WHERE character_id = ? AND profession_id = ?',
                [profession_level, character_id, profession_id]);
        } else {
            await db.query('INSERT INTO character_professions (character_id, profession_id, profession_level) VALUES (?, ?, ?)',
                [character_id, profession_id, profession_level]);
        }

        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error('Error updating profession:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/:id/edit', async (req, res) => {
    const userId = req.params.id;

    try {
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

        if (!user || user.length === 0) {
            return res.status(404).send('User not found');
        }

        if (req.session.userId !== parseInt(userId)) {
            return res.status(403).send('You are not authorized to edit this profile.');
        }

        res.render('base', { page: 'editProfile', title: 'Edit Profile', user: user[0], loggedInUserId: req.session.userId });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/:id/edit', async (req, res) => {
    const userId = req.params.id;
    const { email, bio } = req.body;

    try {
        if (req.session.userId !== parseInt(userId)) {
            return res.status(403).send('You are not authorized to update this profile.');
        }

        await db.query('UPDATE users SET email = ?, bio = ? WHERE id = ?', [email, bio, userId]);

        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/:id/set-main-character', async (req, res) => {
    const userId = req.params.id;
    const { character_id } = req.body;

    try {
        if (req.session.userId !== parseInt(userId)) {
            return res.status(403).send('You are not authorized to update this profile.');
        }

        const [characterResult] = await db.query(
            'SELECT * FROM characters WHERE id = ? AND user_id = ?',
            [character_id, userId]
        );

        const character = characterResult[0];

        if (!character) {
            return res.status(400).send('Invalid character selection.');
        }

        await db.query('UPDATE users SET main_character = ? WHERE id = ?', [character.name, userId]);

        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error('Error setting main character:', error);
        res.status(500).send('Internal Server Error');
    }
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/profiles');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

router.post('/:id/upload-image', upload.single('profileImage'), async (req, res) => {
    const userId = req.params.id;

    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const newImagePath = '/uploads/profiles/' + req.file.filename;

    try {
        const [user] = await db.query('SELECT profile_image FROM users WHERE id = ?', [userId]);

        if (!user || user.length === 0) {
            return res.status(404).send('User not found');
        }

        const oldImagePath = user[0].profile_image;
        if (oldImagePath && oldImagePath !== '/images/default-profile.png') {
            const fullOldImagePath = path.join(__dirname, '../public', oldImagePath);

            if (fs.existsSync(fullOldImagePath)) {
                fs.unlink(fullOldImagePath, (err) => {
                    if (err) {
                        console.error('Error deleting old image:', err);
                    } else {
                        console.log('Old image deleted successfully');
                    }
                });
            }
        }

        await db.query('UPDATE users SET profile_image = ? WHERE id = ?', [newImagePath, userId]);

        res.redirect(`/profile/${userId}`);
    } catch (error) {
        console.error('Error updating profile image:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.post('/:characterId/unclaim-character', isAuthenticated, async (req, res) => {
    const characterId = req.params.characterId;

    try {
        const [user] = await db.query('SELECT user_id FROM characters WHERE id = ?', [characterId]);
        await db.query('UPDATE characters SET user_id = NULL, status = ? WHERE id = ?', ['unclaimed', characterId]);

        req.flash('success', 'Character unclaimed successfully!');
        res.redirect(`/profile/${user[0].user_id}`);
    } catch (error) {
        console.error('Error unclaiming character:', error);
        req.flash('error', 'An error occurred while unclaiming the character.');
        res.redirect(`/profile/${user[0].user_id}`);
    }
});

module.exports = router;
