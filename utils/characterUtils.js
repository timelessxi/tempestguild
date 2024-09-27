const db = require('../config/db'); // Ensure this points to your database configuration

async function moveCharacterToUser(userId, characterName) {
    try {
        // Check if the character exists in the unclaimed_characters table
        const [character] = await db.query('SELECT * FROM unclaimed_characters WHERE name = ?', [characterName]);
        if (!character || character.length === 0) {
            return { success: false, message: 'Character not found in unclaimed characters' };
        }

        // Insert the character into the characters table, linking it to the user
        await db.query('INSERT INTO characters (user_id, guild_id, name, class, level) VALUES (?, ?, ?, ?, ?)', [
            userId,
            1,  // Assuming '1' is the guild_id for Tempest, adjust this as necessary
            character[0].name,
            character[0].class,
            character[0].level
        ]);

        // Remove the character from the unclaimed_characters table
        await db.query('DELETE FROM unclaimed_characters WHERE name = ?', [characterName]);

        return { success: true, message: 'Character moved successfully' };

    } catch (error) {
        console.error('Error moving character:', error);
        return { success: false, message: 'Error occurred while moving character' };
    }
}

module.exports = { moveCharacterToUser };
