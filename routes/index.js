const express = require('express');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const db = require('../config/db'); // Import your database config
const { extractBankItemsFromLuaString, extractCharactersFromLuaString } = require('../utils/luaParser'); // Utility functions

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Home Route
router.get('/', (req, res) => {
    res.render('base', { title: 'Home - Tempest Guild', page: 'home' });
});

// Admin Route
router.get('/admin', async (req, res) => {
    try {
        const [newsArticles] = await db.query('SELECT * FROM news_articles ORDER BY created_at DESC');
        res.render('base', { title: 'Admin - Tempest Guild', page: 'admin', body: 'admin', newsArticles });
    } catch (error) {
        console.error('Error fetching news articles:', error);
        res.status(500).send('Internal Server Error');
    }
});


// News Route
// router.get('/news', (req, res) => {
//     res.render('base', { title: 'News - Tempest Guild', page: 'news' });
// });

// News Management Routes

// Get all news articles (for the public news page)
router.get('/news', async (req, res) => {
    try {
        const [newsArticles] = await db.query('SELECT * FROM news_articles ORDER BY created_at DESC');
        res.render('base', { title: 'Guild News', page: 'news', body: 'news', newsArticles });
    } catch (error) {
        console.error('Error fetching news articles:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Admin: Get all news articles for management
router.get('/admin/news', async (req, res) => {
    try {
        const [newsArticles] = await db.query('SELECT * FROM news_articles ORDER BY created_at DESC');
        res.render('base', { title: 'Admin - Tempest Guild', page: 'admin', body: 'admin', newsArticles });
    } catch (error) {
        console.error('Error fetching news articles:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Admin: Add a new article
router.post('/admin/news/add', async (req, res) => {
    const { title, content } = req.body;

    try {
        await db.query('INSERT INTO news_articles (title, content) VALUES (?, ?)', [title, content]);
        res.redirect('/admin/news');
    } catch (error) {
        console.error('Error adding news article:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Admin: Delete an article
router.post('/admin/news/delete/:id', async (req, res) => {
    const articleId = req.params.id;

    try {
        await db.query('DELETE FROM news_articles WHERE id = ?', [articleId]);
        res.redirect('/admin/news');
    } catch (error) {
        console.error('Error deleting news article:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Admin: Update an article
router.post('/admin/news/edit/:id', async (req, res) => {
    const articleId = req.params.id;
    const { title, content } = req.body;

    try {
        await db.query('UPDATE news_articles SET title = ?, content = ?, updated_at = NOW() WHERE id = ?', [title, content, articleId]);
        res.redirect('/admin/news');
    } catch (error) {
        console.error('Error updating news article:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Contact Route
router.get('/contact', (req, res) => {
    res.render('base', { title: 'Contact - Tempest Guild', page: 'contact' });
});

// Login Route
router.get('/login', (req, res) => {
    res.render('base', { title: 'Login - Tempest Guild', page: 'login' });
});

// Upload Roster Route
router.post('/upload-roster', upload.single('rosterFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = req.file.path; // Path to the uploaded file

    // Read the uploaded GuildRoster.lua file
    fs.readFile(filePath, 'utf8', async (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            return res.status(500).send('Error reading file.');
        }

        try {
            // Extract characters from Lua string
            const characters = extractCharactersFromLuaString(data);

            if (characters.length === 0) {
                return res.status(400).send('No characters found in the file.');
            }

            // Clear the unclaimed_characters table and reset the auto-increment
            await db.query('TRUNCATE TABLE unclaimed_characters');

            // Insert new characters into the database
            const insertPromises = characters.map(character => {
                return db.query(
                    'INSERT INTO unclaimed_characters (name, class, level) VALUES (?, ?, ?)',
                    [character.name, character.class, character.level]
                );
            });

            await Promise.all(insertPromises);

            console.log('Guild Roster updated successfully');

            // Delete the file after processing
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error('Error deleting file:', err);
                    return res.status(500).send('Error deleting file.');
                }
                res.redirect('/admin');
            });

        } catch (parseError) {
            console.error('Error parsing Lua file:', parseError);
            res.status(500).send('Error parsing Lua file.');
        }
    });
});

// Upload Bank Route
router.post('/upload-bank', upload.single('bankFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = req.file.path;

    // Read the uploaded bank file
    fs.readFile(filePath, 'utf8', async (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            return res.status(500).send('Error reading file.');
        }

        try {
            // Extract items from Lua string
            const items = extractBankItemsFromLuaString(data);

            if (items.length === 0) {
                return res.status(400).send('No items found in the file.');
            }

            await db.query('TRUNCATE TABLE guild_bank');
            const insertPromises = items.map(item => {
                // Ensure all required fields are present before inserting
                if (!item.name || !item.type || !item.count || !item.rarity) {
                    console.error(`Skipping item due to missing required fields: ${JSON.stringify(item)}`);
                    return Promise.resolve(); // Skip item and continue with others
                }
                return db.query(
                    'INSERT INTO guild_bank (name, type, count, rarity, subType, stats, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [item.name, item.type, item.count, item.rarity, item.subType || null, item.stats || null, item.source || null]
                ).catch(dbError => {
                    console.error(`Error inserting item ${item.name}:`, dbError);
                });
            });

            await Promise.all(insertPromises);

            console.log('Guild Bank updated successfully');

            // Delete the file after processing
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error('Error deleting file:', err);
                    return res.status(500).send('Error deleting file.');
                }
                res.redirect('/admin');
            });

        } catch (parseError) {
            console.error('Error parsing Lua file:', parseError);
            return res.status(500).send('Error parsing Lua file.');
        }
    });
});

// Register Route
router.get('/register', (req, res) => {
    res.render('base', { title: 'Register - Tempest Guild', page: 'register' });
});

// Login Route (POST)
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const [user] = await db.query('SELECT * FROM users WHERE username = ?', [username]);

        if (user && user.length > 0 && bcrypt.compareSync(password, user[0].password)) {
            req.session.userId = user[0].id;
            res.redirect('/roster');
        } else {
            res.status(401).send('Invalid login credentials');
        }
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Roster Route
router.get('/roster', async (req, res) => {
    const userId = req.session?.userId || null;

    // Query for claimed characters
    const [claimedCharacters] = await db.query(`
        SELECT c.name, c.class, c.level, u.username
        FROM characters c
        JOIN users u ON c.user_id = u.id
    `);

    // Query for unclaimed characters
    const [unclaimedCharacters] = await db.query('SELECT * FROM unclaimed_characters');

    res.render('base', {
        title: 'Guild Roster - Tempest Guild',
        page: 'roster',
        claimedCharacters,
        unclaimedCharacters,
        userId
    });
});

// Bank Route
router.get('/bank', async (req, res) => {
    try {
        // Query for all items
        const [allItems] = await db.query('SELECT * FROM guild_bank');

        // Map rarity numbers to names and CSS classes
        const rarityMap = {
            1: { name: 'Common', class: 'rarity-common' },
            2: { name: 'Uncommon', class: 'rarity-uncommon' },
            3: { name: 'Rare', class: 'rarity-rare' },
            4: { name: 'Epic', class: 'rarity-epic' },
            5: { name: 'Legendary', class: 'rarity-legendary' }
        };

        allItems.forEach(item => {
            item.rarity_name = rarityMap[item.rarity]?.name || 'Unknown';
            item.rarity_class = rarityMap[item.rarity]?.class || '';
        });

        // Categorize items for the tabs
        const weaponItems = allItems.filter(item => item.type === 'Weapon');
        const armorItems = allItems.filter(item => item.type === 'Armor');
        const consumableItems = allItems.filter(item => item.type === 'Consumable');
        const materialItems = allItems.filter(item => item.type === 'Trade Goods');
        const bagItems = allItems.filter(item => item.type === 'Container');

        // Render the bank.ejs template with items
        res.render('base', {
            title: 'Guild Bank - Tempest Guild',
            page: 'bank',
            allItems,
            weaponItems,
            armorItems,
            consumableItems,
            materialItems,
            bagItems
        });
    } catch (error) {
        console.error('Error fetching guild bank data:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
