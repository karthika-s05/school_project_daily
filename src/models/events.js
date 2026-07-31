// Legacy model shim - prefer src/services/eventService.js for new code.
const eventService = require("../services/eventService");

module.exports = {
  getEvent: async (administrationId, callback) => {
    try {
      const data = await eventService.listEvents(
        { administrationId, role: "Admin", userName: "system" },
        {}
      );
      callback(null, [data]);
    } catch (err) {
      callback(err, null);
    }
  },
  getEventById: async (id, administrationId, callback) => {
    try {
      const event = await eventService.getEventById(id, administrationId);
      callback(null, [event ? [event] : []]);
    } catch (err) {
      callback(err, null);
    }
  },
  createUpdateEventsImage: async (id, administrationId, photoUrl, callback) => {
    try {
      const event = await eventService.setAttachment(
        id,
        photoUrl,
        { administrationId, userName: "system", role: "Admin" }
      );
      callback(null, event);
    } catch (err) {
      callback(err, null);
    }
  },
  createUpdateEvent: async (id, EventInfo, userName, administrationId, callback) => {
    try {
      const user = { userName, administrationId, role: "Admin" };
      const event =
        Number(id) > 0
          ? await eventService.updateEvent(id, EventInfo, user)
          : await eventService.createEvent(EventInfo, user);
      callback(null, event);
    } catch (err) {
      callback(err, null);
    }
  },
  deleteEvent: async (id, administrationId, callback) => {
    try {
      const result = await eventService.softDeleteEvent(id, {
        administrationId,
        userName: "system",
        role: "Admin",
      });
      callback(null, result);
    } catch (err) {
      callback(err, null);
    }
  },
};
