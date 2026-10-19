// The club page (About tab). These are the defaults; organisers change the
// links and add photos in the app (Book → Admin → Club Page), which saves
// them to the shared database under club/.

export const CLUB_PAGE = {
  name: 'UCL Fencing',
  tagline: 'University College London fencing club. Foil, épée and sabre, beginners to BUCS.',
  links: {
    su: 'https://studentsunionucl.org/clubs-societies/fencing-club',
    whatsapp: '',
    instagram: '',
    tiktok: '',
    email: '',
  },
};

/** The links in the order they're shown: [key, label, icon, tile colour, hint]. */
export const LINKS = [
  ['su', 'Students’ Union Page', 'globe', 'red', 'Join the club and find out more'],
  ['whatsapp', 'WhatsApp Community', 'whatsapp', 'green', 'Announcements and chat'],
  ['instagram', 'Instagram', 'instagram', 'pink', 'Photos and news'],
  ['tiktok', 'TikTok', 'tiktok', 'black', 'Clips from training and competitions'],
  ['email', 'Email the Committee', 'mail', 'blue', null],
];
