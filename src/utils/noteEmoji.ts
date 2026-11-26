export const EMOJI_CATEGORIES = ['Smileys', 'Nature', 'Objects', 'Books and education', 'Science', 'Productivity', 'Travel', 'Symbols'] as const
export type EmojiCategory = typeof EMOJI_CATEGORIES[number]

const emojiByCategory: Record<EmojiCategory, string> = {
  Smileys: '😀 Grinning face|happy smile;😊 Smiling face|blush happy;😂 Tears of joy|laugh lol;😍 Heart eyes|love;🥰 Smiling with hearts|love;😎 Sunglasses|cool;🤔 Thinking face|question idea;🧐 Monocle|inspect curious;😌 Relieved face|calm;😴 Sleeping face|tired rest;🙌 Raising hands|celebrate hooray;👋 Waving hand|hello goodbye',
  Nature: '🌱 Seedling|plant grow sprout;🌿 Herb|leaf greenery;🍃 Leaf in wind|nature;🌳 Tree|oak forest;🌵 Cactus|desert;🌻 Sunflower|garden;🌼 Blossom|flower;🦋 Butterfly|insect;🐝 Honeybee|bug;🍀 Four-leaf clover|luck;☀️ Sun|daylight;🌙 Crescent moon|night;🌈 Rainbow|weather;🌊 Wave|ocean',
  Objects: '💡 Light bulb|idea;🔍 Magnifying glass|search;📷 Camera|photo;🎧 Headphones|music;🎨 Palette|art paint;☕ Hot beverage|coffee tea;🧰 Toolbox|tools;🎁 Gift|present;🧩 Puzzle piece|solve;🕯️ Candle|light;🖼️ Framed picture|image art;🛠️ Hammer and wrench|tools',
  'Books and education': '📖 Open book|read study;📚 Books|library textbook;📕 Closed book|read;📒 Ledger|notebook;📓 Notebook|journal;📝 Memo|note write;✏️ Pencil|draw;🖊️ Pen|ink;🎓 Graduation cap|school university;🏫 School|education;🔖 Bookmark|save reading;📄 Page|document paper',
  Science: '🔬 Microscope|research lab;🧪 Test tube|chemistry;⚗️ Alembic|flask experiment;⚛️ Atom|physics molecule;🧬 DNA|genes biology;🧫 Petri dish|cells culture;🔭 Telescope|space astronomy;🧲 Magnet|physics;🧠 Brain|thinking;🌡️ Thermometer|temperature;🦠 Microbe|biology',
  Productivity: '✅ Check mark|done complete;📌 Pushpin|pin;📎 Paperclip|attachment;🗓️ Calendar|date event;⏰ Alarm clock|reminder time;⏳ Hourglass|timer;📊 Bar chart|graph metrics;📈 Increasing chart|growth trend;📋 Clipboard|checklist task;📁 Folder|file;💻 Laptop|computer work;🎯 Direct hit|target goal;🚀 Rocket|launch project',
  Travel: '✈️ Airplane|flight;🧳 Luggage|bag trip;🗺️ World map|route;📍 Round pushpin|location;🧭 Compass|direction;🚲 Bicycle|bike;🚆 Train|rail;🚗 Car|drive;⛰️ Mountain|hike;🏕️ Camping|tent;🏖️ Beach|vacation;🌍 Globe|earth world',
  Symbols: '❤️ Red heart|love;⭐ Star|favorite;✨ Sparkles|shine;🔥 Fire|hot;⚡ Lightning|bolt energy;❗ Exclamation mark|important;❓ Question mark|help;➕ Plus|add;🔄 Arrows circle|refresh repeat;♻️ Recycling|reuse;💬 Speech bubble|comment;🔔 Bell|notification;🎉 Party popper|celebration',
}

export const NOTE_EMOJIS = EMOJI_CATEGORIES.flatMap((category) => emojiByCategory[category].split(';').map((item) => {
  const space = item.indexOf(' ')
  const [name, keywords] = item.slice(space + 1).split('|')
  return { glyph: item.slice(0, space), name, keywords, category }
}))

export function containsEmoji(text: string) {
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text)
}
