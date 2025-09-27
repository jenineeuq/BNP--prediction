const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { models } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
                       'application/vnd.ms-excel', // .xls
                       'text/csv']; // .csv
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
    files: 1
  }
});

// Upload file endpoint
router.post('/upload', [
  authenticateToken,
  upload.single('file'),
  body('dataType').isIn(['churn', 'sales', 'mixed']).withMessage('Invalid data type')
], async (req, res, next) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        code: 'NO_FILE'
      });
    }

    const { dataType } = req.body;

    // Create upload session
    const uploadSession = await models.UploadSession.create({
      user_id: req.user.id,
      filename: req.file.filename,
      original_filename: req.file.originalname,
      file_size: req.file.size,
      file_type: req.file.mimetype,
      data_type: dataType,
      status: 'uploading'
    });

    // Process file asynchronously
    processFileAsync(uploadSession.id, req.file.path, dataType);

    res.status(201).json({
      message: 'File uploaded successfully',
      uploadSession: {
        id: uploadSession.id,
        filename: uploadSession.original_filename,
        status: uploadSession.status,
        dataType: uploadSession.data_type,
        createdAt: uploadSession.created_at
      }
    });

  } catch (error) {
    next(error);
  }
});

// Get upload sessions for current user
router.get('/sessions', authenticateToken, async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { user_id: req.user.id };
    if (status) {
      whereClause.status = status;
    }

    const { count, rows: sessions } = await models.UploadSession.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [{
        model: models.CustomerData,
        as: 'customerData',
        attributes: ['id']
      }]
    });

    const sessionsWithCounts = sessions.map(session => ({
      ...session.toJSON(),
      recordCount: session.customerData.length
    }));

    res.json({
      sessions: sessionsWithCounts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    next(error);
  }
});

// Get specific upload session
router.get('/sessions/:id', authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;

    const session = await models.UploadSession.findOne({
      where: {
        id: id,
        user_id: req.user.id
      },
      include: [{
        model: models.CustomerData,
        as: 'customerData',
        limit: 100 // Limit for preview
      }]
    });

    if (!session) {
      return res.status(404).json({
        error: 'Upload session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }

    res.json({
      session: {
        ...session.toJSON(),
        sampleData: session.customerData.slice(0, 10) // Return first 10 records as sample
      }
    });

  } catch (error) {
    next(error);
  }
});

// Delete upload session (admin only)
router.delete('/sessions/:id', [
  authenticateToken,
  requireRole(['admin'])
], async (req, res, next) => {
  try {
    const { id } = req.params;

    const session = await models.UploadSession.findByPk(id);
    if (!session) {
      return res.status(404).json({
        error: 'Upload session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }

    // Delete associated data
    await models.CustomerData.destroy({
      where: { upload_session_id: id }
    });

    await models.AnalyticsResult.destroy({
      where: { upload_session_id: id }
    });

    // Delete the session
    await session.destroy();

    // Delete the file
    const filePath = path.join(__dirname, '../../uploads', session.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({
      message: 'Upload session deleted successfully'
    });

  } catch (error) {
    next(error);
  }
});

// Get upload progress
router.get('/sessions/:id/progress', authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;

    const session = await models.UploadSession.findOne({
      where: {
        id: id,
        user_id: req.user.id
      }
    });

    if (!session) {
      return res.status(404).json({
        error: 'Upload session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }

    res.json({
      progress: session.getProgress(),
      status: session.status,
      totalRecords: session.total_records,
      processedRecords: session.processed_records,
      processingTime: session.getProcessingTime(),
      errorMessage: session.error_message
    });

  } catch (error) {
    next(error);
  }
});

// Helper function to process file asynchronously
async function processFileAsync(sessionId, filePath, dataType) {
  try {
    const session = await models.UploadSession.findByPk(sessionId);
    if (!session) return;

    // Update status to processing
    await session.update({ status: 'processing' });

    // Read and parse file
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    if (!jsonData || jsonData.length === 0) {
      throw new Error('File contains no data');
    }

    // Update total records
    await session.update({ total_records: jsonData.length });

    // Process and validate data
    const processedData = [];
    let processedCount = 0;

    for (const row of jsonData) {
      try {
        const processedRow = processDataRow(row);
        processedData.push({
          ...processedRow,
          upload_session_id: sessionId
        });
        processedCount++;

        // Update progress every 100 records
        if (processedCount % 100 === 0) {
          await session.update({ processed_records: processedCount });
        }
      } catch (error) {
        console.error('Error processing row:', error);
        // Continue processing other rows
      }
    }

    // Bulk insert processed data
    if (processedData.length > 0) {
      await models.CustomerData.bulkCreate(processedData);
    }

    // Update session as completed
    await session.update({
      status: 'completed',
      processed_records: processedCount,
      processing_completed_at: new Date()
    });

    console.log(`File processing completed for session ${sessionId}: ${processedCount} records processed`);

  } catch (error) {
    console.error('File processing error:', error);
    
    // Update session with error
    const session = await models.UploadSession.findByPk(sessionId);
    if (session) {
      await session.update({
        status: 'failed',
        error_message: error.message
      });
    }
  }
}

// Helper function to process individual data row
function processDataRow(row) {
  // Map and validate the data
  const processedRow = {
    order_id: String(row.order_id || row.Order_ID || ''),
    customer_id: String(row.customer_id || row.Customer_ID || ''),
    age: parseInt(row.age || row.Age || 0),
    gender: String(row.gender || row.Gender || 'Other'),
    product_id: String(row.product_id || row.Product_ID || ''),
    country: String(row.country || row.Country || ''),
    signup_date: new Date(row.signup_date || row.Signup_Date || new Date()),
    last_purchase_date: new Date(row.last_purchase_date || row.Last_Purchase_Date || new Date()),
    cancellations_count: parseInt(row.cancellations_count || row.Cancellations_Count || 0),
    subscription_status: String(row.subscription_status || row.Subscription_Status || 'Active'),
    unit_price: parseFloat(row.unit_price || row.Unit_Price || 0),
    quantity: parseInt(row.quantity || row.Quantity || 1),
    purchase_frequency: parseInt(row.purchase_frequency || row.Purchase_Frequency || 0),
    product_name: String(row.product_name || row.Product_Name || ''),
    category: String(row.category || row.Category || ''),
    ratings: parseFloat(row.ratings || row.Ratings || 0)
  };

  // Basic validation
  if (!processedRow.order_id || !processedRow.customer_id || !processedRow.product_id) {
    throw new Error('Missing required fields: order_id, customer_id, or product_id');
  }

  if (processedRow.age < 0 || processedRow.age > 120) {
    throw new Error('Invalid age value');
  }

  if (processedRow.unit_price < 0) {
    throw new Error('Invalid unit price');
  }

  if (processedRow.quantity < 1) {
    throw new Error('Invalid quantity');
  }

  if (processedRow.ratings < 1 || processedRow.ratings > 5) {
    throw new Error('Invalid ratings value');
  }

  return processedRow;
}

module.exports = router;
