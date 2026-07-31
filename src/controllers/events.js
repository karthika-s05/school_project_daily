const eventService = require("../services/eventService");
const logger = require("../config/winston");
const notificationService = require("../services/notificationService");

const ok = (res, message, data = null, statusCode = 200) =>
  res.status(statusCode).send({
    status: "success",
    message,
    data,
  });

// Prefer HTTP 200/400 for API errors. IIS often replaces HTTP 500 JSON bodies
// with its generic HTML "Server Error" page, hiding the real message.
const fail = (res, error, _statusCode = 400) => {
  const sqlMessage = error?.sqlMessage || null;
  const message =
    (typeof error === "string" ? error : null) ||
    error?.message ||
    sqlMessage ||
    "Request failed";
  console.error("[events]", message, sqlMessage || error?.code || "");
  return res.status(200).send({
    status: "Error",
    message: sqlMessage ? `${message} (${sqlMessage})` : message,
    data: [],
  });
};

const parseBody = (req) => {
  const body = { ...req.body };
  ["classIds", "studentIds", "targets"].forEach((key) => {
    if (typeof body[key] === "string") {
      try {
        body[key] = JSON.parse(body[key]);
      } catch (_) {
        if (key !== "targets") {
          body[key] = String(body[key])
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        }
      }
    }
  });
  return body;
};

module.exports = {
  getEvent: async (req, res) => {
    try {
      const filters = {
        status: req.query.status || req.body?.status,
        eventType: req.query.eventType || req.body?.eventType,
        title: req.query.title || req.body?.title,
        date: req.query.date || req.body?.date,
        fromDate: req.query.fromDate || req.body?.fromDate,
        toDate: req.query.toDate || req.body?.toDate,
        classId: req.query.classId || req.body?.classId,
        sectionId: req.query.sectionId || req.body?.sectionId,
        limit: req.query.limit || req.body?.limit,
      };
      const data = await eventService.listEvents(req.user, filters);
      logger.info(`${req.path} -- ${req.method} -- Success`);
      return ok(res, "Events list retrieved success", data);
    } catch (error) {
      return fail(res, error);
    }
  },

  getEventById: async (req, res) => {
    try {
      const id = req.body.id || req.params.id;
      if (!id) return fail(res, "Event id is required");
      const event = await eventService.getEventById(id, req.user.administrationId);
      if (!event) return fail(res, "Event not found");

      const role = notificationService.canonicalRole(req.user.role);
      if (role === "Staff") {
        const isOwner =
          String(event.createdBy) === String(req.user.userName) &&
          String(event.createdByRole).toLowerCase() === "staff";
        const isPublishedAdmin =
          event.status === "Published" &&
          String(event.createdByRole).toLowerCase() === "admin";
        if (!isOwner && !isPublishedAdmin) {
          return fail(res, "Forbidden");
        }
      }
      if (role === "Student" && event.status !== "Published") {
        return fail(res, "Event not found");
      }

      return ok(res, "Events list retrieved success", [event]);
    } catch (error) {
      return fail(res, error);
    }
  },

  createUpdateEvents: async (req, res) => {
    try {
      const body = parseBody(req);
      const id = Number(body.id || 0);
      let event;
      if (id > 0) {
        event = await eventService.updateEvent(id, body, req.user);
        return ok(res, "Events updated success", event);
      }
      event = await eventService.createEvent(body, req.user);
      return ok(res, "Events created success", event);
    } catch (error) {
      return fail(res, error);
    }
  },

  createUpdateEventsImage: async (req, res) => {
    try {
      const id = Number(req.body.id || 0);
      if (!id) return fail(res, "Save the event first, then upload attachment");
      if (!req.file) return fail(res, "Attachment file is required");

      const relativePath = String(req.file.path || "")
        .split("\\")
        .join("/");
      const attachmentUrl = `/${relativePath.replace(/^\/+/, "")}`;
      const event = await eventService.setAttachment(id, attachmentUrl, req.user);
      return ok(res, "Events attachment updated success", event);
    } catch (error) {
      return fail(res, error);
    }
  },

  deleteEvent: async (req, res) => {
    try {
      const id = req.params.id || req.body.id;
      if (!id) return fail(res, "Event id is required");
      const result = await eventService.softDeleteEvent(id, req.user);
      return ok(res, "Event deleted success", result);
    } catch (error) {
      return fail(res, error);
    }
  },

  publishEvent: async (req, res) => {
    try {
      const id = req.params.id || req.body.id;
      if (!id) return fail(res, "Event id is required");
      const result = await eventService.publishEvent(id, req.user);
      return ok(res, "Event published successfully", result);
    } catch (error) {
      return fail(res, error);
    }
  },

  unpublishEvent: async (req, res) => {
    try {
      const id = req.params.id || req.body.id;
      if (!id) return fail(res, "Event id is required");
      const result = await eventService.unpublishEvent(id, req.user);
      return ok(res, "Event unpublished successfully", result);
    } catch (error) {
      return fail(res, error);
    }
  },

  getEventHistory: async (req, res) => {
    try {
      const id = req.params.id || req.body.id;
      if (!id) return fail(res, "Event id is required");
      const event = await eventService.getEventById(id, req.user.administrationId);
      if (!event) return fail(res, "Event not found");
      const role = notificationService.canonicalRole(req.user.role);
      if (
        role === "Staff" &&
        String(event.createdBy) !== String(req.user.userName)
      ) {
        return fail(res, "Forbidden");
      }
      const history = await eventService.getHistory(id, req.user.administrationId);
      return ok(res, "Event history retrieved", history);
    } catch (error) {
      return fail(res, error);
    }
  },

  getEventSummary: async (req, res) => {
    try {
      const summary = await eventService.getSummary(req.user);
      return ok(res, "Event summary retrieved", summary);
    } catch (error) {
      return fail(res, error);
    }
  },

  getEventMeta: async (req, res) => {
    const role = notificationService.canonicalRole(req.user.role);
    return ok(res, "Event metadata retrieved", {
      eventTypes:
        role === "Staff"
          ? eventService.STAFF_EVENT_TYPES
          : eventService.ADMIN_EVENT_TYPES,
      audienceTypes:
        role === "Staff"
          ? [
              "Entire Class",
              "Selected Section",
              "Selected Student",
              "Selected Students",
            ]
          : [
              "All Staff",
              "All Students",
              "All Staff & Students",
              "Selected Class",
              "Selected Section",
              "Multiple Classes",
              "Entire School",
            ],
      priorities: eventService.PRIORITIES,
    });
  },
};
