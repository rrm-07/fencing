// Defaults for the training timetable. Once an organiser edits the timetable
// on the booking page it lives in the database instead (booking/config), so
// this file only seeds it. Keep the ids: existing bookings refer to them.

export const CLUB = {
  title: 'Training',
  subtitle: 'Book your place',
  timeZone: 'Europe/London',
};

/** Default places per session (organisers can change it per session). */
export const CAPACITY = 30;

/** How far ahead weekly sessions can be booked. One-off sessions show up to EVENT_WEEKS ahead. */
export const WEEKS_AHEAD = 2;
export const EVENT_WEEKS = 12;

export const OFFSITE_NOTE = 'Offsite · bring your own kit';

/** Venue names offered as quick picks in the session editor. */
export const KNOWN_VENUES = ['Mandela Studio, TeamUCL Gym', 'Central London FC'];

// day: 0 = Sunday … 6 = Saturday. Times are UK local time (24h).
export const DEFAULT_WEEKLY = [
  { id: 'mon-clfc', day: 1, title: 'Central London FC', start: '19:00', end: '21:00', offsite: true },
  { id: 'wed-mandela', day: 3, title: 'Mandela Studio, TeamUCL Gym', start: '11:30', end: '13:30' },
  { id: 'wed-clfc', day: 3, title: 'Central London FC', start: '19:00', end: '21:00', offsite: true },
  { id: 'thu-mandela', day: 4, title: 'Mandela Studio, TeamUCL Gym', start: '15:00', end: '17:00' },
  { id: 'sat-mandela', day: 6, title: 'Mandela Studio, TeamUCL Gym', start: '10:00', end: '13:00' },
];
