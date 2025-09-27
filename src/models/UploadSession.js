const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const UploadSession = sequelize.define(
    "UploadSession",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      filename: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      original_filename: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      file_size: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      file_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      data_type: {
        type: DataTypes.ENUM("churn", "sales", "mixed"),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("uploading", "processing", "completed", "failed"),
        defaultValue: "uploading",
        allowNull: false,
      },
      total_records: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      processed_records: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      processing_started_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      processing_completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
      },
    },
    {
      tableName: "upload_sessions",
      indexes: [
        {
          fields: ["user_id"],
        },
        {
          fields: ["status"],
        },
        {
          fields: ["data_type"],
        },
        {
          fields: ["created_at"],
        },
      ],
      hooks: {
        beforeUpdate: (uploadSession) => {
          // Update processing timestamps
          if (uploadSession.changed("status")) {
            if (
              uploadSession.status === "processing" &&
              !uploadSession.processing_started_at
            ) {
              uploadSession.processing_started_at = new Date();
            } else if (
              uploadSession.status === "completed" &&
              !uploadSession.processing_completed_at
            ) {
              uploadSession.processing_completed_at = new Date();
            }
          }
        },
      },
    }
  );

  // Instance methods
  UploadSession.prototype.getProgress = function () {
    if (this.total_records === 0) return 0;
    return Math.round((this.processed_records / this.total_records) * 100);
  };

  UploadSession.prototype.getProcessingTime = function () {
    if (!this.processing_started_at) return null;
    const endTime = this.processing_completed_at || new Date();
    return Math.round((endTime - this.processing_started_at) / 1000); // seconds
  };

  UploadSession.prototype.toJSON = function () {
    const values = { ...this.get() };
    values.progress = this.getProgress();
    values.processing_time = this.getProcessingTime();
    return values;
  };

  return UploadSession;
};
