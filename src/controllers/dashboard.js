const dashboardModel = require("../models/dashboard");
const logger = require("../config/winston");

module.exports = {
  getStaffSummary: async (req, res) => {
    const { userName, administrationId } = req.user;
    console.log(req.user, "user");
    try {
      if (!userName || administrationId == null) {
        return res.send({ status: "Error", message: "Missing Credential", data: [] });
      }
      await dashboardModel.getStaffSummary(
        userName,
        administrationId,
        (err, summary) => {
          if (err) {
            res.send({
              status: "Error",
              message: "Staff dashboard summary not retrieved",
              data: err.sqlMessage || err,
            });
          } else {
            logger.info(`${req.path} -- ${req.method} -- Success`);
            res.send({
              status: "success",
              message: "Staff dashboard summary retrieved successfully",
              data: summary,
            });
          }
        }
      );
    } catch (error) {
      res.send({ status: "Error", message: error?.message || error, data: [] });
    }
  },
};
