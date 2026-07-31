const {format, createLogger, transports} = require('winston')
const { combine, timestamp, errors, json, prettyPrint, printf } = format
const appRoot = require('app-root-path')
require('dotenv').config()

function buildProdLogger() {

  const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} ${level}: ${stack || message}`;
  });

  return createLogger({
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss'}),
      format.errors({stack: true}),
      logFormat,
      json(),
      format.prettyPrint()
    ),
    defaultMeta: { services: 'user-service'},
    transports: [
      new transports.File({ filename: `${appRoot}/schoolDailyactivity_api_errors.log`, level: 'error', json: true}),
      new transports.File({ filename: `${appRoot}/logs/schoolDailyactivity.log`, level: 'info', json: true})
    ]
  })
}

module.exports = buildProdLogger