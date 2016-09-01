'use strict';

const _ = require('lodash');
const path = require('path');

class AwsCompileFunctions {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = 'aws';

    this.hooks = {
      'deploy:compileFunctions': this.compileFunctions.bind(this),
    };
  }

  compileFunctions() {
    if (typeof this.serverless.service.provider.iamRoleARN !== 'string') {
      // merge in the iamRoleLambdaTemplate
      const iamRoleLambdaExecutionTemplate = this.serverless.utils.readFileSync(
        path.join(this.serverless.config.serverlessPath,
          'plugins',
          'aws',
          'deploy',
          'compile',
          'functions',
          'iam-role-lambda-execution-template.json')
      );

      _.merge(this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
        iamRoleLambdaExecutionTemplate);

      // merge in the iamPolicyLambdaTemplate
      const iamPolicyLambdaExecutionTemplate = this.serverless.utils.readFileSync(
        path.join(this.serverless.config.serverlessPath,
          'plugins',
          'aws',
          'deploy',
          'compile',
          'functions',
          'iam-policy-lambda-execution-template.json')
      );

      _.merge(this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
        iamPolicyLambdaExecutionTemplate);

      // set the necessary variables for the IamPolicyLambda
      this.serverless.service.provider.compiledCloudFormationTemplate
        .Resources
        .IamPolicyLambdaExecution
        .Properties
        .PolicyName = `${this.options.stage}-${this.serverless.service.service}-lambda`;
      this.serverless.service.provider.compiledCloudFormationTemplate
        .Resources
        .IamPolicyLambdaExecution
        .Properties
        .PolicyDocument
        .Statement[0]
        .Resource = `arn:aws:logs:${this.options.region}:*:*`;

      // add custom iam role statements
      if (this.serverless.service.provider.iamRoleStatements &&
        this.serverless.service.provider.iamRoleStatements instanceof Array) {
        this.serverless.service.provider.compiledCloudFormationTemplate
          .Resources
          .IamPolicyLambdaExecution
          .Properties
          .PolicyDocument
          .Statement = this.serverless.service.provider.compiledCloudFormationTemplate
          .Resources
          .IamPolicyLambdaExecution
          .Properties
          .PolicyDocument
          .Statement.concat(this.serverless.service.provider.iamRoleStatements);
      }
    }

    const functionTemplate = `
      {
        "Type": "AWS::Lambda::Function",
        "Properties": {
          "Code": {
            "S3Bucket": { "Ref": "ServerlessDeploymentBucket" },
            "S3Key": "S3Key"
          },
          "FunctionName": "FunctionName",
          "Handler": "Handler",
          "MemorySize": "MemorySize",
          "Role": "Role",
          "Runtime": "Runtime",
          "Timeout": "Timeout"
        }
      }
    `;

    const outputTemplate = `
      {
        "Description": "Lambda function info",
        "Value": "Value"
      }
     `;

    this.serverless.service.getAllFunctions().forEach((functionName) => {
      const newFunction = JSON.parse(functionTemplate);
      const functionObject = this.serverless.service.getFunction(functionName);

      newFunction.Properties.Code
        .S3Key = `${this.serverless.service.package.artifactDirectoryName
        }/${this.serverless.service.package.artifact.split(path.sep).pop()}`;

      if (!functionObject.handler) {
        const errorMessage = [
          `Missing "handler" property in function ${functionName}`,
          ' Please make sure you point to the correct lambda handler.',
          ' For example: handler.hello.',
          ' Please check the docs for more info',
        ].join('');
        throw new this.serverless.classes
          .Error(errorMessage);
      }

      const Handler = functionObject.handler;
      const FunctionName = functionObject.name;
      const MemorySize = Number(functionObject.memorySize)
        || Number(this.serverless.service.provider.memorySize)
        || 1024;
      const Timeout = Number(functionObject.timeout)
        || Number(this.serverless.service.provider.timeout)
        || 6;
      const Runtime = this.serverless.service.provider.runtime
        || 'nodejs4.3';

      newFunction.Properties.Handler = Handler;
      newFunction.Properties.FunctionName = FunctionName;
      newFunction.Properties.MemorySize = MemorySize;
      newFunction.Properties.Timeout = Timeout;
      newFunction.Properties.Runtime = Runtime;

      if (typeof this.serverless.service.provider.iamRoleARN === 'string') {
        newFunction.Properties.Role = this.serverless.service.provider.iamRoleARN;
      } else {
        newFunction.Properties.Role = { 'Fn::GetAtt': ['IamRoleLambdaExecution', 'Arn'] };
      }

      // Check if a VPC should be used
      if (!functionObject.vpc) functionObject.vpc = {};
      if (!this.serverless.service.provider.vpc) this.serverless.service.provider.vpc = {};

      newFunction.Properties.VpcConfig = {
        SecurityGroupIds: functionObject.vpc.securityGroupIds ||
          this.serverless.service.provider.vpc.securityGroupIds,
        SubnetIds: functionObject.vpc.subnetIds || this.serverless.service.provider.vpc.subnetIds,
      };

      if (!newFunction.Properties.VpcConfig.SecurityGroupIds
        || !newFunction.Properties.VpcConfig.SubnetIds) {
        delete newFunction.Properties.VpcConfig;
      }

      // add the VPC permissions to the lambda execution role if a VPC config is given
      if (newFunction.Properties.VpcConfig) {
        // merge in the iamPolicyLambdaVPCTemplate
        const iamPolicyLambdaVpcTemplate = this.serverless.utils.readFileSync(
          path.join(this.serverless.config.serverlessPath,
            'plugins',
            'aws',
            'deploy',
            'compile',
            'functions',
            'iam-policy-lambda-vpc-template.json')
        );

        _.merge(this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
          iamPolicyLambdaVpcTemplate);
      }

      const normalizedFunctionName = functionName[0].toUpperCase() + functionName.substr(1);
      const functionLogicalId = `${normalizedFunctionName}LambdaFunction`;

      const newFunctionObject = {
        [functionLogicalId]: newFunction,
      };

      _.merge(this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
        newFunctionObject);

      // Add function to Outputs section
      const newOutput = JSON.parse(outputTemplate);
      newOutput.Value = { 'Fn::GetAtt': [functionLogicalId, 'Arn'] };

      const newOutputObject = {
        [`${functionLogicalId}Arn`]: newOutput,
      };

      _.merge(this.serverless.service.provider.compiledCloudFormationTemplate.Outputs,
        newOutputObject);
    });
  }
}

module.exports = AwsCompileFunctions;
