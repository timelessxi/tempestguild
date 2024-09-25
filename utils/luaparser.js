const luaparse = require('luaparse'); // Lua parser for parsing Lua files

// Function to extract bank items from Lua string
function extractBankItemsFromLuaString(luaString) {
    const items = [];

    try {
        const ast = luaparse.parse(luaString);
        const guildBankDataNode = ast.body.find(node =>
            node.type === 'AssignmentStatement' &&
            node.variables[0].type === 'Identifier' &&
            node.variables[0].name === 'GuildBankData'
        );

        if (!guildBankDataNode) {
            console.error('Error: Could not find GuildBankData in Lua file');
            return [];
        }

        const guildBankDataTable = guildBankDataNode.init[0];
        if (!guildBankDataTable || guildBankDataTable.type !== 'TableConstructorExpression') {
            console.error('Error: GuildBankData is not a table');
            return [];
        }

        const itemsField = guildBankDataTable.fields.find(field =>
            ((field.type === 'TableKeyString' && field.key.name === 'items') ||
                (field.type === 'TableKey' && field.key.type === 'StringLiteral' && field.key.raw === '"items"')) &&
            field.value.type === 'TableConstructorExpression'
        );

        if (!itemsField) {
            console.error('Error: Could not find items in GuildBankData');
            return [];
        }

        itemsField.value.fields.forEach(itemField => {
            if (itemField.type === 'TableValue' && itemField.value.type === 'TableConstructorExpression') {
                const item = {};
                itemField.value.fields.forEach(field => {
                    let key = null;
                    let value = null;

                    if (field.type === 'TableKeyString' && field.key.type === 'Identifier') {
                        key = field.key.name;
                    } else if (field.type === 'TableKey' && field.key.type === 'StringLiteral') {
                        key = field.key.raw.replace(/(^"|"$)/g, '');
                    } else {
                        return;
                    }

                    const valueNode = field.value;
                    switch (valueNode.type) {
                        case 'StringLiteral':
                            value = valueNode.raw.replace(/(^"|"$)/g, '');
                            break;
                        case 'NumericLiteral':
                            value = valueNode.value;
                            break;
                        case 'BooleanLiteral':
                            value = valueNode.value;
                            break;
                        case 'TableConstructorExpression':
                            if (key === 'stats') {
                                const statsArray = valueNode.fields.map(f => {
                                    if (f.type === 'TableValue' && f.value.type === 'StringLiteral') {
                                        return f.value.raw.replace(/(^"|"$)/g, '');
                                    }
                                    return null;
                                }).filter(v => v !== null);
                                value = statsArray.join('\n');
                            } else {
                                value = null;
                            }
                            break;
                        default:
                            value = null;
                    }

                    item[key] = value;
                });

                if (item.name) {
                    items.push(item);
                }
            }
        });

        return items;
    } catch (err) {
        console.error('Error parsing Lua file:', err);
        return [];
    }
}

// Function to extract characters from Lua string
function extractCharactersFromLuaString(luaString) {
    const characterPattern = /\["name"\]\s*=\s*"([^"]+)"[\s\S]*?\["level"\]\s*=\s*(\d+)[\s\S]*?\["class"\]\s*=\s*"([^"]+)"/g;
    let match;
    const characters = [];

    while ((match = characterPattern.exec(luaString)) !== null) {
        let name = match[1].trim();
        const level = parseInt(match[2], 10);
        const charClass = match[3].trim();

        name = name.split('-')[0];

        characters.push({
            name,
            class: charClass,
            level: isNaN(level) ? 0 : level
        });
    }

    return characters;
}

module.exports = {
    extractBankItemsFromLuaString,
    extractCharactersFromLuaString
};
