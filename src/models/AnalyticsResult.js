const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AnalyticsResult = sequelize.define('AnalyticsResult', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    upload_session_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'upload_sessions',
        key: 'id'
      }
    },
    analysis_type: {
      type: DataTypes.ENUM('churn_distribution', 'feature_importance', 'sales_forecast', 'nps_trend', 'dashboard_stats', 'customer_segments'),
      allowNull: false
    },
    result_data: {
      type: DataTypes.JSON,
      allowNull: false
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    },
    generated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false
    },
    is_cached: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    cache_expires_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'analytics_results',
    indexes: [
      {
        fields: ['upload_session_id']
      },
      {
        fields: ['analysis_type']
      },
      {
        fields: ['generated_at']
      },
      {
        fields: ['is_cached']
      },
      {
        fields: ['cache_expires_at']
      }
    ],
    hooks: {
      beforeCreate: (analyticsResult) => {
        // Set cache expiration for certain analysis types
        if (analyticsResult.analysis_type === 'dashboard_stats') {
          analyticsResult.is_cached = true;
          analyticsResult.cache_expires_at = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
        } else if (['churn_distribution', 'feature_importance'].includes(analyticsResult.analysis_type)) {
          analyticsResult.is_cached = true;
          analyticsResult.cache_expires_at = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        }
      }
    }
  });

  // Instance methods
  AnalyticsResult.prototype.isExpired = function() {
    if (!this.is_cached || !this.cache_expires_at) return false;
    return new Date() > this.cache_expires_at;
  };

  AnalyticsResult.prototype.toJSON = function() {
    const values = { ...this.get() };
    values.is_expired = this.isExpired();
    return values;
  };

  // Static methods
  AnalyticsResult.findValidCache = async function(uploadSessionId, analysisType) {
    const result = await this.findOne({
      where: {
        upload_session_id: uploadSessionId,
        analysis_type: analysisType,
        is_cached: true
      },
      order: [['generated_at', 'DESC']]
    });

    if (result && !result.isExpired()) {
      return result;
    }
    return null;
  };

  AnalyticsResult.clearExpiredCache = async function() {
    const expiredResults = await this.findAll({
      where: {
        is_cached: true,
        cache_expires_at: {
          [sequelize.Sequelize.Op.lt]: new Date()
        }
      }
    });

    if (expiredResults.length > 0) {
      await this.destroy({
        where: {
          id: {
            [sequelize.Sequelize.Op.in]: expiredResults.map(r => r.id)
          }
        }
      });
    }

    return expiredResults.length;
  };

  return AnalyticsResult;
};
