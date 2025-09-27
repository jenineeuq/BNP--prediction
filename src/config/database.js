const { Sequelize } = require("sequelize");
const path = require("path");
const fs = require("fs");

// Ensure data directory exists
const dataDir = path.join(__dirname, "../../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: process.env.DB_PATH || path.join(dataDir, "customer_metrics.db"),
  logging: process.env.NODE_ENV === "development" ? console.log : false,
  define: {
    timestamps: true,
    underscored: true,
  },
});

// Import models
const User = require("../models/User")(sequelize);
const CustomerData = require("../models/CustomerData")(sequelize);
const UploadSession = require("../models/UploadSession")(sequelize);
const AnalyticsResult = require("../models/AnalyticsResult")(sequelize);

// Define associations
User.hasMany(UploadSession, { foreignKey: "user_id", as: "uploadSessions" });
UploadSession.belongsTo(User, { foreignKey: "user_id", as: "user" });

UploadSession.hasMany(CustomerData, {
  foreignKey: "upload_session_id",
  as: "customerData",
});
CustomerData.belongsTo(UploadSession, {
  foreignKey: "upload_session_id",
  as: "uploadSession",
});

UploadSession.hasMany(AnalyticsResult, {
  foreignKey: "upload_session_id",
  as: "analyticsResults",
});
AnalyticsResult.belongsTo(UploadSession, {
  foreignKey: "upload_session_id",
  as: "uploadSession",
});

const initializeDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log("📊 Database connection established successfully");

    // Sync all models
    await sequelize.sync({ alter: true });
    console.log("📋 Database models synchronized");

    // Create default admin user if it doesn't exist
    await createDefaultAdmin();

    return sequelize;
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error);
    throw error;
  }
};

const createDefaultAdmin = async () => {
  try {
    const existingAdmin = await User.findOne({
      where: { email: "admin@bnpparibas.com" },
    });
    if (!existingAdmin) {
      const bcrypt = require("bcryptjs");
      const hashedPassword = await bcrypt.hash("admin123", 12);

      await User.create({
        email: "admin@bnpparibas.com",
        password: hashedPassword,
        name: "Admin User",
        role: "admin",
        is_active: true,
      });

      console.log("👤 Default admin user created");
    }
  } catch (error) {
    console.error("❌ Error creating default admin:", error);
  }
};

module.exports = {
  sequelize,
  initializeDatabase,
  models: {
    User,
    CustomerData,
    UploadSession,
    AnalyticsResult,
  },
};
