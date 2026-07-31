const logger = require("../config/winston");
const notificationService = require("../services/notificationService");

module.exports = {
  getnotification: async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const identity = await notificationService.resolveNotificationIdentity(
        req.user
      );
      if (
        !identity.administrationId ||
        !identity.receiverIds.length ||
        !identity.receiverRole
      ) {
        return res.status(400).send({
          status: "Error",
          message: "Missing Credential",
          data: [],
        });
      }
      const filters = {
        receiverIds: identity.receiverIds,
        receiverRole: identity.receiverRole,
        administrationId: identity.administrationId,
        notificationType: req.query.type,
        unreadOnly: String(req.query.unreadOnly || "").toLowerCase() === "true",
        limit: req.query.limit,
      };
      const [notifications, count] = await Promise.all([
        notificationService.listNotifications(filters),
        notificationService.unreadCount(
          identity.receiverIds,
          identity.administrationId,
          identity.receiverRole
        ),
      ]);
      logger.info(`${req.path} -- ${req.method} -- Success`);
      return res.send({
        status: "success",
        message: "Notification list retrieved",
        count,
        data: notifications,
      });
    } catch (error) {
      logger.info(`${req.path} -- ${req.method} -- Error`);
      return res.status(500).send({
        status: "Error",
        message: error?.message || "Notification list not retrieved",
        data: [],
      });
    }
  },

  createnotification: async (req, res) => {
    try {
      const { administrationId, userName } = req.user;
      const {
        title,
        message,
        notificationType = "Announcement",
        receiverId,
        receiverRole,
        targetAudience,
        audience,
        classId,
        sectionId,
        department,
        referenceId,
      } = req.body;
      if (!message || !administrationId) {
        return res.status(400).send({
          status: "Error",
          message: "message and administrationId are required",
        });
      }

      const payload = {
        title,
        message,
        notificationType,
        senderId: userName,
        administrationId,
        classId,
        sectionId,
        department,
        referenceId,
      };
      let result;
      if (receiverId && receiverRole) {
        result = await notificationService.createNotification({
          ...payload,
          receiverId,
          receiverRole,
        });
      } else {
        result = await notificationService.notifyAudience({
          ...payload,
          audience: targetAudience || audience,
        });
      }
      logger.info(`${req.path} -- ${req.method} -- Success`);
      return res.status(201).send({
        status: "success",
        message: "Notification created successfully",
        data: result,
      });
    } catch (error) {
      return res.status(400).send({
        status: "Error",
        message: error?.message || "Notification not created",
        data: [],
      });
    }
  },

  markAsRead: async (req, res) => {
    try {
      const identity = await notificationService.resolveNotificationIdentity(
        req.user
      );
      const result = await notificationService.markAsRead(
        req.params.id,
        identity.receiverIds,
        identity.administrationId,
        identity.receiverRole
      );
      if (result.found === false) {
        return res.status(404).send({
          status: "Error",
          message: "Notification not found",
        });
      }
      return res.send({ status: "success", message: "Notification marked as read" });
    } catch (error) {
      return res.status(500).send({
        status: "Error",
        message: error?.message || "Notification not updated",
      });
    }
  },

  deletenotification: async (req, res) => {
    try {
      const identity = await notificationService.resolveNotificationIdentity(
        req.user
      );
      const result = await notificationService.deleteNotification(
        req.params.id,
        identity.receiverIds,
        identity.administrationId,
        identity.receiverRole
      );
      if (!result.affectedRows) {
        return res.status(404).send({
          status: "Error",
          message: "Notification not found",
        });
      }
      return res.send({ status: "success", message: "Notification deleted" });
    } catch (error) {
      return res.status(500).send({
        status: "Error",
        message: error?.message || "Notification not deleted",
      });
    }
  },

  updatenotificationTime: async (req, res) => {
    try {
      const identity = await notificationService.resolveNotificationIdentity(
        req.user
      );
      if (
        !identity.administrationId ||
        !identity.receiverIds.length ||
        !identity.receiverRole
      ) {
        return res.status(400).send({
          status: "Error",
          message: "Missing Credential",
        });
      }
      await notificationService.markAllAsRead(
        identity.receiverIds,
        identity.administrationId,
        identity.receiverRole
      );
      return res.send({
        status: "success",
        message: "All notifications marked as read",
      });
    } catch (error) {
      return res.status(500).send({
        status: "Error",
        message: error?.message || "Notifications not updated",
      });
    }
  },
};
