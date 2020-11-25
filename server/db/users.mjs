import { customAlphabet } from "nanoid";

// Safe for ArrayBuffer/base64 converting
const alphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const nanoid = customAlphabet(alphabet, 23);

export class Users {
  constructor() {
    this.db = new Map();
  }
  addDevice(id, device) {
    this.getById(id).devices.push(device);
  }
  createUserId() {
    return nanoid();
  }
  createUser(user) {
    const id = this.createUserId();

    return {
      ...user,
      id,
      devices: [],
      name: user.name || "User " + (this.db.size + 1),
    };
  }
  add(user) {
    const newUser = user.id ? user : this.createUser(user);

    this.db.set(newUser.id, newUser);

    return newUser;
  }
  getById(id) {
    return this.db.get(id);
  }
  getByCredentialID(id) {
    const mapIter = this.db.values();

    for (let user of mapIter) {
      if (user.devices.find(device => device.credentialID === id)) {
        return user;
      }
    }
  }
}
