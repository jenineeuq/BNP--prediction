const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CustomerData = sequelize.define('CustomerData', {
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
    order_id: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    customer_id: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    age: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 0,
        max: 120
      }
    },
    gender: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [['Male', 'Female', 'Other', 'M', 'F', 'male', 'female', 'other']]
      }
    },
    product_id: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    signup_date: {
      type: DataTypes.DATE,
      allowNull: false
    },
    last_purchase_date: {
      type: DataTypes.DATE,
      allowNull: false
    },
    cancellations_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    subscription_status: {
      type: DataTypes.ENUM('Active', 'Inactive', 'Cancelled', 'Paused'),
      allowNull: false
    },
    unit_price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1
      }
    },
    purchase_frequency: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 0
      }
    },
    product_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    ratings: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    // Calculated fields
    age_group: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    months_since_last_purchase: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    lifetime_value: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    churn_probability: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0,
        max: 1
      }
    },
    churn_risk: {
      type: DataTypes.ENUM('Low', 'Medium', 'High'),
      allowNull: true
    },
    promotion_eligible: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    retention_strategy: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'customer_data',
    indexes: [
      {
        fields: ['upload_session_id']
      },
      {
        fields: ['customer_id']
      },
      {
        fields: ['churn_risk']
      },
      {
        fields: ['subscription_status']
      },
      {
        fields: ['category']
      },
      {
        fields: ['country']
      },
      {
        fields: ['age_group']
      }
    ],
    hooks: {
      beforeCreate: (customerData) => {
        // Calculate derived fields
        calculateDerivedFields(customerData);
      },
      beforeUpdate: (customerData) => {
        // Recalculate derived fields if relevant data changed
        if (customerData.changed('age') || customerData.changed('last_purchase_date') || 
            customerData.changed('unit_price') || customerData.changed('quantity') || 
            customerData.changed('purchase_frequency')) {
          calculateDerivedFields(customerData);
        }
      }
    }
  });

  // Helper function to calculate derived fields
  function calculateDerivedFields(customerData) {
    // Age group
    const age = customerData.age;
    if (age < 25) customerData.age_group = 'Under 25';
    else if (age < 35) customerData.age_group = '25-34';
    else if (age < 45) customerData.age_group = '35-44';
    else if (age < 60) customerData.age_group = '45-59';
    else customerData.age_group = '60+';

    // Months since last purchase
    if (customerData.last_purchase_date) {
      const now = new Date();
      const lastPurchase = new Date(customerData.last_purchase_date);
      const diffTime = Math.abs(now - lastPurchase);
      customerData.months_since_last_purchase = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 30));
    }

    // Lifetime value
    customerData.lifetime_value = customerData.unit_price * customerData.quantity * customerData.purchase_frequency;

    // Churn probability and risk
    const churnScore = calculateChurnScore(customerData);
    customerData.churn_probability = churnScore;
    customerData.churn_risk = churnScore > 0.7 ? 'High' : churnScore > 0.4 ? 'Medium' : 'Low';

    // Promotion eligibility
    customerData.promotion_eligible = customerData.lifetime_value > 1000 && 
                                    customerData.ratings >= 4 && 
                                    customerData.subscription_status === 'Active';

    // Retention strategy
    customerData.retention_strategy = generateRetentionStrategy(customerData);
  }

  function calculateChurnScore(customerData) {
    let score = 0;

    // Age factor
    if (customerData.age < 25) score += 0.1;
    else if (customerData.age > 60) score += 0.2;

    // Cancellations
    score += customerData.cancellations_count * 0.15;

    // Months since last purchase
    const monthsSince = customerData.months_since_last_purchase || 0;
    if (monthsSince > 6) score += 0.3;
    else if (monthsSince > 3) score += 0.15;

    // Purchase frequency
    if (customerData.purchase_frequency < 2) score += 0.2;

    // Subscription status
    if (customerData.subscription_status === 'Inactive') score += 0.25;
    else if (customerData.subscription_status === 'Cancelled') score += 0.5;

    // Ratings
    if (customerData.ratings < 3) score += 0.2;
    else if (customerData.ratings < 4) score += 0.1;

    return Math.min(Math.max(score, 0), 1);
  }

  function generateRetentionStrategy(customerData) {
    if (customerData.churn_risk === 'Low') {
      return customerData.promotion_eligible
        ? 'Offer premium products or loyalty rewards'
        : 'Continue engagement with regular offers';
    }

    if (customerData.churn_risk === 'Medium') {
      const strategies = [];
      if (customerData.months_since_last_purchase > 3) {
        strategies.push('Send re-engagement campaign');
      }
      if (customerData.ratings < 4) {
        strategies.push('Improve customer experience');
      }
      if (customerData.purchase_frequency < 2) {
        strategies.push(`Offer discounts on ${customerData.category} products`);
      }
      return strategies.join('; ') || 'Personalized retention offer';
    }

    // High risk
    return `Urgent: Personal outreach, 20% discount on ${customerData.category}, loyalty program enrollment`;
  }

  return CustomerData;
};
