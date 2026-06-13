import fs from 'fs';
import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  encoding: 'utf8',
  failOnErrors: true,
  verbose: false,
  format: 'json',
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'My Astro Sky API',
      version: '0.1.0',
      description: 'API documentation generated from Swagger JSDoc annotations',
    },
  },
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'My Astro Sky API',
      version: '0.1.0',
      description: 'API documentation generated from Swagger JSDoc annotations',
    },
  },
  apis: ['server/*.ts'],
};

const swaggerSpec = swaggerJsdoc(options);
const outputPath = path.join(process.cwd(), 'public', 'swagger.json');
await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
await fs.promises.writeFile(outputPath, JSON.stringify(swaggerSpec, null, 2) + '\n', 'utf8');
console.log(`Swagger JSON written to ${outputPath}`);
