const os = require("os");

const interfaces = os.networkInterfaces();
let addresses;

exports.ipAddress = async () => {
  for (const key in interfaces) {
    for await (const iface of interfaces[key]) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses = iface.address;
      }
    }
  }
  console.log("IP addresses:", addresses);
  return addresses;d1
};
