const express = require("express");
const { Op } = require("sequelize");
const { models } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Get dashboard statistics
router.get("/stats/:sessionId", authenticateToken, async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    // Check if we have cached results
    const cachedResult = await models.AnalyticsResult.findValidCache(
      sessionId,
      "dashboard_stats"
    );
    if (cachedResult) {
      return res.json(cachedResult.result_data);
    }

    // Verify session belongs to user
    const session = await models.UploadSession.findOne({
      where: { id: sessionId, user_id: req.user.id },
    });

    if (!session) {
      return res.status(404).json({
        error: "Upload session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    // Get basic statistics
    const totalCustomers = await models.CustomerData.count({
      where: { upload_session_id: sessionId },
      distinct: true,
      col: "customer_id",
    });

    const totalRecords = await models.CustomerData.count({
      where: { upload_session_id: sessionId },
    });

    const highRiskCustomers = await models.CustomerData.count({
      where: {
        upload_session_id: sessionId,
        churn_risk: "High",
      },
      distinct: true,
      col: "customer_id",
    });

    const totalRevenue = await models.CustomerData.sum("lifetime_value", {
      where: { upload_session_id: sessionId },
    });

    const avgOrderValue = await models.CustomerData.findOne({
      where: { upload_session_id: sessionId },
      attributes: [
        [
          models.CustomerData.sequelize.fn(
            "AVG",
            models.CustomerData.sequelize.literal("unit_price * quantity")
          ),
          "avg_order_value",
        ],
      ],
      raw: true,
    });

    const stats = {
      totalCustomers,
      totalRecords,
      churnRate:
        totalCustomers > 0
          ? Math.round((highRiskCustomers / totalCustomers) * 100)
          : 0,
      totalRevenue: totalRevenue || 0,
      averageOrderValue: parseFloat(avgOrderValue?.avg_order_value) || 0,
      highRiskCustomers,
      predictedSalesGrowth: Math.round(Math.random() * 20 + 5), // Mock prediction
      dataQuality: calculateDataQuality(sessionId),
      lastUpdated: new Date().toISOString(),
    };

    // Cache the result
    await models.AnalyticsResult.create({
      upload_session_id: sessionId,
      analysis_type: "dashboard_stats",
      result_data: stats,
    });

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get recent upload sessions for dashboard
router.get("/recent-sessions", authenticateToken, async (req, res, next) => {
  try {
    const { limit = 5 } = req.query;

    const sessions = await models.UploadSession.findAll({
      where: { user_id: req.user.id },
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      include: [
        {
          model: models.CustomerData,
          as: "customerData",
          attributes: ["id"],
          limit: 1,
        },
      ],
    });

    const sessionsWithCounts = sessions.map((session) => ({
      id: session.id,
      filename: session.original_filename,
      dataType: session.data_type,
      status: session.status,
      recordCount: session.customerData.length,
      createdAt: session.created_at,
      progress: session.getProgress(),
    }));

    res.json(sessionsWithCounts);
  } catch (error) {
    next(error);
  }
});

// Get data quality metrics
router.get(
  "/data-quality/:sessionId",
  authenticateToken,
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      // Verify session belongs to user
      const session = await models.UploadSession.findOne({
        where: { id: sessionId, user_id: req.user.id },
      });

      if (!session) {
        return res.status(404).json({
          error: "Upload session not found",
          code: "SESSION_NOT_FOUND",
        });
      }

      const qualityMetrics = await calculateDataQuality(sessionId);

      res.json(qualityMetrics);
    } catch (error) {
      next(error);
    }
  }
);

// Get country analysis
router.get(
  "/country-analysis/:sessionId",
  authenticateToken,
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      // Verify session belongs to user
      const session = await models.UploadSession.findOne({
        where: { id: sessionId, user_id: req.user.id },
      });

      if (!session) {
        return res.status(404).json({
          error: "Upload session not found",
          code: "SESSION_NOT_FOUND",
        });
      }

      const countryData = await models.CustomerData.findAll({
        where: { upload_session_id: sessionId },
        attributes: [
          "country",
          [
            models.CustomerData.sequelize.fn(
              "COUNT",
              models.CustomerData.sequelize.fn(
                "DISTINCT",
                models.CustomerData.sequelize.col("customer_id")
              )
            ),
            "total_customers",
          ],
          [
            models.CustomerData.sequelize.fn(
              "SUM",
              models.CustomerData.sequelize.literal("unit_price * quantity")
            ),
            "total_revenue",
          ],
          [
            models.CustomerData.sequelize.fn(
              "SUM",
              models.CustomerData.sequelize.literal(
                'CASE WHEN churn_risk = "High" THEN 1 ELSE 0 END'
              )
            ),
            "churned_customers",
          ],
        ],
        group: ["country"],
        order: [
          [
            models.CustomerData.sequelize.fn(
              "SUM",
              models.CustomerData.sequelize.literal("unit_price * quantity")
            ),
            "DESC",
          ],
        ],
        raw: true,
      });

      const analysis = countryData.map((country) => ({
        country: country.country,
        totalCustomers: parseInt(country.total_customers),
        totalRevenue: parseFloat(country.total_revenue) || 0,
        churnRate:
          country.total_customers > 0
            ? Math.round(
                (country.churned_customers / country.total_customers) * 100
              )
            : 0,
        avgOrderValue:
          country.total_customers > 0
            ? parseFloat(country.total_revenue) /
              parseInt(country.total_customers)
            : 0,
      }));

      res.json(analysis);
    } catch (error) {
      next(error);
    }
  }
);

// Get product category analysis
router.get(
  "/category-analysis/:sessionId",
  authenticateToken,
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      // Verify session belongs to user
      const session = await models.UploadSession.findOne({
        where: { id: sessionId, user_id: req.user.id },
      });

      if (!session) {
        return res.status(404).json({
          error: "Upload session not found",
          code: "SESSION_NOT_FOUND",
        });
      }

      const categoryData = await models.CustomerData.findAll({
        where: { upload_session_id: sessionId },
        attributes: [
          "category",
          [
            models.CustomerData.sequelize.fn(
              "COUNT",
              models.CustomerData.sequelize.fn(
                "DISTINCT",
                models.CustomerData.sequelize.col("customer_id")
              )
            ),
            "total_customers",
          ],
          [
            models.CustomerData.sequelize.fn(
              "SUM",
              models.CustomerData.sequelize.literal("unit_price * quantity")
            ),
            "total_revenue",
          ],
          [
            models.CustomerData.sequelize.fn(
              "AVG",
              models.CustomerData.sequelize.col("ratings")
            ),
            "avg_rating",
          ],
          [
            models.CustomerData.sequelize.fn(
              "COUNT",
              models.CustomerData.sequelize.col("id")
            ),
            "total_orders",
          ],
        ],
        group: ["category"],
        order: [
          [
            models.CustomerData.sequelize.fn(
              "SUM",
              models.CustomerData.sequelize.literal("unit_price * quantity")
            ),
            "DESC",
          ],
        ],
        raw: true,
      });

      const analysis = categoryData.map((category) => ({
        category: category.category,
        totalCustomers: parseInt(category.total_customers),
        totalRevenue: parseFloat(category.total_revenue) || 0,
        avgRating: parseFloat(category.avg_rating) || 0,
        totalOrders: parseInt(category.total_orders),
        avgOrderValue:
          parseInt(category.total_orders) > 0
            ? parseFloat(category.total_revenue) /
              parseInt(category.total_orders)
            : 0,
      }));

      res.json(analysis);
    } catch (error) {
      next(error);
    }
  }
);

// Get subscription status analysis
router.get(
  "/subscription-analysis/:sessionId",
  authenticateToken,
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      // Verify session belongs to user
      const session = await models.UploadSession.findOne({
        where: { id: sessionId, user_id: req.user.id },
      });

      if (!session) {
        return res.status(404).json({
          error: "Upload session not found",
          code: "SESSION_NOT_FOUND",
        });
      }

      const subscriptionData = await models.CustomerData.findAll({
        where: { upload_session_id: sessionId },
        attributes: [
          "subscription_status",
          [
            models.CustomerData.sequelize.fn(
              "COUNT",
              models.CustomerData.sequelize.fn(
                "DISTINCT",
                models.CustomerData.sequelize.col("customer_id")
              )
            ),
            "count",
          ],
          [
            models.CustomerData.sequelize.fn(
              "AVG",
              models.CustomerData.sequelize.col("lifetime_value")
            ),
            "avg_lifetime_value",
          ],
          [
            models.CustomerData.sequelize.fn(
              "AVG",
              models.CustomerData.sequelize.col("churn_probability")
            ),
            "avg_churn_probability",
          ],
        ],
        group: ["subscription_status"],
        raw: true,
      });

      const total = subscriptionData.reduce(
        (sum, item) => sum + parseInt(item.count),
        0
      );

      const analysis = subscriptionData.map((subscription) => ({
        status: subscription.subscription_status,
        count: parseInt(subscription.count),
        percentage:
          total > 0 ? Math.round((subscription.count / total) * 100) : 0,
        avgLifetimeValue: parseFloat(subscription.avg_lifetime_value) || 0,
        churnProbability: parseFloat(subscription.avg_churn_probability) || 0,
      }));

      res.json(analysis);
    } catch (error) {
      next(error);
    }
  }
);

// Helper function to calculate data quality
async function calculateDataQuality(sessionId) {
  const totalRecords = await models.CustomerData.count({
    where: { upload_session_id: sessionId },
  });

  if (totalRecords === 0) {
    return {
      completeness: 0,
      accuracy: 0,
      consistency: 0,
      overall: 0,
    };
  }

  // Check completeness (non-null values)
  const completenessChecks = await Promise.all([
    models.CustomerData.count({
      where: { upload_session_id: sessionId, customer_id: { [Op.ne]: null } },
    }),
    models.CustomerData.count({
      where: { upload_session_id: sessionId, product_name: { [Op.ne]: null } },
    }),
    models.CustomerData.count({
      where: { upload_session_id: sessionId, unit_price: { [Op.gt]: 0 } },
    }),
  ]);

  const completeness = Math.round(
    (completenessChecks.reduce((sum, count) => sum + count, 0) /
      (completenessChecks.length * totalRecords)) *
      100
  );

  // Check accuracy (valid ranges)
  const accuracyChecks = await Promise.all([
    models.CustomerData.count({
      where: { upload_session_id: sessionId, age: { [Op.between]: [0, 120] } },
    }),
    models.CustomerData.count({
      where: {
        upload_session_id: sessionId,
        ratings: { [Op.between]: [1, 5] },
      },
    }),
    models.CustomerData.count({
      where: { upload_session_id: sessionId, quantity: { [Op.gt]: 0 } },
    }),
  ]);

  const accuracy = Math.round(
    (accuracyChecks.reduce((sum, count) => sum + count, 0) /
      (accuracyChecks.length * totalRecords)) *
      100
  );

  // Check consistency (valid enum values)
  const consistencyChecks = await Promise.all([
    models.CustomerData.count({
      where: {
        upload_session_id: sessionId,
        subscription_status: {
          [Op.in]: ["Active", "Inactive", "Cancelled", "Paused"],
        },
      },
    }),
    models.CustomerData.count({
      where: {
        upload_session_id: sessionId,
        churn_risk: { [Op.in]: ["Low", "Medium", "High"] },
      },
    }),
  ]);

  const consistency = Math.round(
    (consistencyChecks.reduce((sum, count) => sum + count, 0) /
      (consistencyChecks.length * totalRecords)) *
      100
  );

  const overall = Math.round((completeness + accuracy + consistency) / 3);

  return {
    completeness,
    accuracy,
    consistency,
    overall,
    totalRecords,
  };
}

module.exports = router;
