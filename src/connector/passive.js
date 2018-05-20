const net = require('net');
const tls = require('tls');
const ip = require('ip');
const Promise = require('bluebird');

const Connector = require('./base');
const findPort = require('../helpers/find-port');
const errors = require('../errors');

class Passive extends Connector {
  constructor(connection) {
    super(connection);
    this.type = 'passive';
    this.log = connection.log.scope('passive');
  }

  waitForConnection({timeout = 5000, delay = 250} = {}) {
    if (!this.dataServer) return Promise.reject(new errors.ConnectorError('Passive server not setup'));

    const checkSocket = () => {
      if (this.dataServer && this.dataServer.listening && this.dataSocket && this.dataSocket.connected) {
        return Promise.resolve(this.dataSocket);
      }
      return Promise.resolve().delay(delay)
      .then(() => checkSocket());
    };

    return checkSocket().timeout(timeout);
  }

  setupServer() {
    const closeExistingServer = () => this.dataServer ?
      new Promise(resolve => this.dataServer.close(() => resolve())) :
      Promise.resolve();

    return closeExistingServer()
    .then(() => this.getPort())
    .then(port => {
      const connectionHandler = socket => {
        if (!ip.isEqual(this.connection.commandSocket.remoteAddress, socket.remoteAddress)) {
          this.log.error('ip address mismatch', {
            pasv_connection: socket.remoteAddress,
            cmd_connection: this.connection.commandSocket.remoteAddress
          });

          socket.destroy();
          return this.connection.reply(550, 'IP address mismatch')
          .finally(() => this.connection.close());
        }
        this.log.debug('connection', {port, remoteAddress: socket.remoteAddress});

        if (this.connection.secure) {
          const secureContext = tls.createSecureContext(this.server._tls);
          const secureSocket = new tls.TLSSocket(socket, {
            isServer: true,
            secureContext
          });
          this.dataSocket = secureSocket;
        } else {
          this.dataSocket = socket;
        }
        this.dataSocket.connected = true;
        this.dataSocket.setEncoding(this.connection.transferType);
        this.dataSocket.on('error', err => this.connection.emit('error', err));
        this.dataSocket.on('close', () => {
          this.log.debug('socket closed');
          this.end();
        });
      };

      this.dataSocket = null;
      this.dataServer = net.createServer({pauseOnConnect: true}, connectionHandler);
      this.dataServer.maxConnections = 1;
      this.dataServer.on('error', err => this.connection.emit('error', err));
      this.dataServer.on('close', () => {
        this.log.debug('server closed');
        this.dataServer = null;
      });

      return new Promise((resolve, reject) => {
        this.dataServer.listen(port, err => {
          if (err) reject(err);
          else {
            this.log.debug('listening', {port});
            resolve(this.dataServer);
          }
        });
      });
    });
  }

  getPort() {
    if (this.server.options.pasv_range) {
      const [min, max] = typeof this.server.options.pasv_range === 'string' ?
        this.server.options.pasv_range.split('-').map(v => v ? parseInt(v) : v) :
        [this.server.options.pasv_range];
      return findPort(min, max);
    }
    throw new errors.ConnectorError('Invalid pasv_range');
  }

}
module.exports = Passive;
