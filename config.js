/*
 * Board settings. Edit, commit, and GitHub Pages picks up the change in a minute.
 */
window.BOARD_CONFIG = {
  // Paste your Apps Script web app URL here (it ends with /exec).
  // While this is empty the board runs in demo mode: sample sign-ups, saved in your browser only.
  apiUrl: "",

  title: "Explore the Abyss",
  tagline: "Daily endgame dungeon runs, Monday to Friday at 21:00 server time.",

  // Shown before the sheet answers. After that the sheet's own settings (top of Code.gs) win,
  // so change start time or run days there.
  timeZone: "Europe/Berlin",
  startTime: "21:00",
  days: [1, 2, 3, 4, 5], // 1 = Monday ... 7 = Sunday

  // One party. Once a slot type is full, the next person in that role starts another group.
  party: { tank: 1, healer: 1, dps: 3 },

  // How often an open board checks for new sign-ups.
  refreshSeconds: 45,

  // Dungeon preference options. "id" is what the sheet stores, so keep ids stable once people
  // have signed up. "short" is used where space is tight.
  dungeons: [
    { id: "brd", name: "Blackrock Depths", short: "BRD" },
    { id: "lbrs", name: "Lower Blackrock Spire", short: "LBRS" },
    { id: "bmh", name: "Blackmaw Hold", short: "Blackmaw" },
    { id: "dme", name: "Dire Maul East", short: "DM East" },
    { id: "dmw", name: "Dire Maul West", short: "DM West" },
    { id: "dmn", name: "Dire Maul North", short: "DM North" },
    { id: "scholo", name: "Scholomance", short: "Scholo" },
    { id: "strat-live", name: "Stratholme Live", short: "Strat Live" },
    { id: "strat-ud", name: "Stratholme Undead", short: "Strat UD" },
    { id: "terrace", name: "Shaper's Terrace", short: "Terrace" }
  ],

  // Class colours follow the game. Shaman blue is lifted a little from #0070DD so names stay
  // readable on the dark background. Roles: tank, healer, melee, ranged.
  classes: [
    { id: "druid", name: "Druid", color: "#FF7C0A",
      specs: [["Balance", "ranged"], ["Feral (Bear)", "tank"], ["Feral (Cat)", "melee"], ["Restoration", "healer"]] },
    { id: "hunter", name: "Hunter", color: "#AAD372",
      specs: [["Beast Mastery", "ranged"], ["Marksmanship", "ranged"], ["Survival", "ranged"]] },
    { id: "mage", name: "Mage", color: "#3FC7EB",
      specs: [["Arcane", "ranged"], ["Fire", "ranged"], ["Frost", "ranged"]] },
    { id: "paladin", name: "Paladin", color: "#F48CBA",
      specs: [["Holy", "healer"], ["Protection", "tank"], ["Retribution", "melee"]] },
    { id: "priest", name: "Priest", color: "#FFFFFF",
      specs: [["Discipline", "healer"], ["Holy", "healer"], ["Shadow", "ranged"]] },
    { id: "rogue", name: "Rogue", color: "#FFF468",
      specs: [["Assassination", "melee"], ["Combat", "melee"], ["Subtlety", "melee"]] },
    { id: "shaman", name: "Shaman", color: "#2E8AE6",
      specs: [["Elemental", "ranged"], ["Enhancement", "melee"], ["Restoration", "healer"]] },
    { id: "warlock", name: "Warlock", color: "#8788EE",
      specs: [["Affliction", "ranged"], ["Demonology", "ranged"], ["Destruction", "ranged"]] },
    { id: "warrior", name: "Warrior", color: "#C69B6D",
      specs: [["Arms", "melee"], ["Fury", "melee"], ["Protection", "tank"]] }
  ]
};
