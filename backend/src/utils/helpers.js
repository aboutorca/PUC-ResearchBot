import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a unique ID
 * @returns {string} A unique ID
 */
function generateId() {
  return uuidv4();
}

/**
 * Ensure a directory exists, create it if it doesn't
 * @param {string} dirPath - Path to the directory
 * @returns {Promise<void>}
 */
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Save data to a JSON file
 * @param {string} filePath - Path to the file
 * @param {*} data - Data to save
 * @returns {Promise<void>}
 */
async function saveJsonToFile(filePath, data) {
  try {
    const dirPath = path.dirname(filePath);
    await ensureDirectoryExists(dirPath);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error saving JSON to ${filePath}:`, error);
    throw error;
  }
}

/**
 * Read data from a JSON file
 * @param {string} filePath - Path to the file
 * @returns {Promise<Object>} Parsed JSON data
 */
async function readJsonFromFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // File doesn't exist
    }
    console.error(`Error reading JSON from ${filePath}:`, error);
    throw error;
  }
}

/**
 * Format a date as YYYY-MM-DD
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Calculate the similarity between two vectors using cosine similarity
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Similarity score between 0 and 1
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Truncate text to a maximum length, adding ellipsis if truncated
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} [ellipsis='...'] - Ellipsis string
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength, ellipsis = '...') {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Parse a date string into a Date object
 * @param {string} dateString - Date string to parse
 * @returns {Date} Parsed date or current date if parsing fails
 */
function parseDate(dateString) {
  if (!dateString) return new Date();
  
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Convert a string to title case
 * @param {string} str - String to convert
 * @returns {string} Title-cased string
 */
function toTitleCase(str) {
  if (!str) return '';
  return str.replace(
    /\w\S*/g,
    txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

/**
 * Remove HTML tags from a string
 * @param {string} html - HTML string
 * @returns {string} Text with HTML tags removed
 */
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '');
}

/**
 * Generate a slug from a string
 * @param {string} str - String to convert to slug
 * @returns {string} URL-friendly slug
 */
function slugify(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/--+/g, '-') // Replace multiple - with single -
    .trim();
}

export {
  generateId,
  ensureDirectoryExists,
  saveJsonToFile,
  readJsonFromFile,
  formatDate,
  cosineSimilarity,
  truncateText,
  parseDate,
  toTitleCase,
  stripHtml,
  slugify
};
