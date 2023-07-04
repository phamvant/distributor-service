const httpStatus = require('http-status');
const path = require('node:path');
const fs = require('node:fs');
const { v4 } = require('uuid');
const catchAsync = require('../utils/catchAsync');
const { bundle } = require('../utils/bundle');
const ApiError = require('../utils/ApiError');
const projectService = require('../services/project.service');
const pick = require('../utils/pick');
const logger = require('../config/logger');
const GRPCServer = require('../utils/GRPCServer');
const { uploadToS3 } = require('../services/aws.service');

const create = catchAsync(async (req, res) => {
  const { inputFile, sourceFile } = req.files;
  const { name, categories } = req.body;
  const id = v4();

  const uploadFolder = path.join(process.cwd(), '/uploads', `${id}`);
  if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
  }

  fs.rename(inputFile[0].path, path.join(uploadFolder, `input.txt`), (err) => {
    if (err) {
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Failed to save input file');
    }
  });

  const sourceBundledPath = path.join(uploadFolder, `source.js`);

  bundle(sourceFile[0].path, sourceBundledPath, async (error) => {
    if (error) {
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Failed to bundle files');
    }
  });

  const newProject = {
    name,
    categories,
    id,
  };

  await uploadToS3(id, uploadFolder);
  const response = await GRPCServer.createProject(id);
  logger.info(`Project ${name} is serving at port ${response.port}`);

  newProject.port = response.port;
  // record to database
  const project = await projectService.createProject(newProject);

  if (!project) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Failed to create project');
  }

  res.status(httpStatus.CREATED).send({ project });
});

const getProjects = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'id']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const projects = await projectService.getProjects(filter, options);
  res.send({ projects, metadata: {} });
});

const getProjectById = catchAsync(async (req, res) => {
  logger.info(`Finding project with id: ${req.params.projectId}`);
  const project = await projectService.getProjectById(req.params.projectId);
  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }
  res.send(project);
});

module.exports = {
  create,
  getProjects,
  getProjectById,
};
