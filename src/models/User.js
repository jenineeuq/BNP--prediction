const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        len: [6, 255]
      }
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        len: [2, 100]
      }
    },
    role: {
      type: DataTypes.ENUM('admin', 'analyst', 'viewer'),
      defaultValue: 'analyst',
      allowNull: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true
    },
    login_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    }
  }, {
    tableName: 'users',
    indexes: [
      {
        unique: true,
        fields: ['email']
      },
      {
        fields: ['role']
      },
      {
        fields: ['is_active']
      }
    ],
    hooks: {
      beforeCreate: (user) => {
        // Ensure email is lowercase
        if (user.email) {
          user.email = user.email.toLowerCase().trim();
        }
      },
      beforeUpdate: (user) => {
        // Ensure email is lowercase
        if (user.email) {
          user.email = user.email.toLowerCase().trim();
        }
      }
    }
  });

  // Instance methods
  User.prototype.toJSON = function() {
    const values = { ...this.get() };
    delete values.password; // Never return password in JSON
    return values;
  };

  User.prototype.updateLoginInfo = async function() {
    this.last_login = new Date();
    this.login_count += 1;
    await this.save();
  };

  return User;
};
