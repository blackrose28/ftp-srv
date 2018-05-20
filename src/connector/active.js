const {Socket} = require('net');
const tls = require('tls');
const Promise = require('bluebird');
const Connector = require('./base');

class Active extends Connector {
  constructor(connection) {
    super(connection);
    this.type = 'active';
    this.log = connection.log.scope('active');
  }

  waitForConnection({timeout = 5000, delay = 250} = {}) {
    const checkSocket = () => {
      if (this.dataSocket && this.dataSocket.connected) {
        return Promise.resolve(this.dataSocket);
      }
      return Promise.resolve().delay(delay)
      .then(() => checkSocket());
    };

    return checkSocket().timeout(timeout);
  }

  setupConnection(host, port, family = 4) {
    const closeExistingServer = () => Promise.resolve(
      this.dataSocket ? this.dataSocket.destroy() : undefined);

    return closeExistingServer()
    .then(() => {
      this.dataSocket = new Socket();
      this.dataSocket.setEncoding(this.connection.transferType);
      this.dataSocket.on('error', err => this.connection.emit('error', err));
      this.dataSocket.on('close', () => {
        this.log.debug('socket closed');
        this.end();
      });
      this.dataSocket.connect({host, port, family}, () => {
        this.dataSocket.pause();

        this.log.debug('connection', {port, remoteAddress: this.dataSocket.remoteAddress});

        if (this.connection.secure) {
          const secureContext = tls.createSecureContext(this.server._tls);
          const secureSocket = new tls.TLSSocket(this.dataSocket, {
            isServer: true,
            secureContext
          });
          this.dataSocket = secureSocket;
        }
        this.dataSocket.connected = true;
      });
    });
  }
}
module.exports = Active;
