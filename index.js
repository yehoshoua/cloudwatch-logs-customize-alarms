var aws = require('aws-sdk');
var cwl = new aws.CloudWatchLogs();
let region = process.env.AWS_REGION;
let topic = process.env.SNS_TOPIC;
aws.config.update({region: region});
var sns = new aws.SNS({apiVersion: '2010-03-31'});

exports.handler = function(event, context) {
    var message = JSON.parse(event.Records[0].Sns.Message);
    var subject = event.Records[0].Sns.Subject;
    var requestParams = {
        metricName: message.Trigger.MetricName,
        metricNamespace: message.Trigger.Namespace
    };

    cwl.describeMetricFilters(requestParams, function(err, data) {
        if(err) {
            console.log('Error is:', err.stack);
        } else {
            sleep(3000).then(() => {
                getLogsAndSendMessage(message, data, subject, null);
            });
        }
    });
};

function sleep (time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

function getLogsAndSendMessage(message, metricFilterData, subject, next_token) {
    var timestamp = Date.parse(message.StateChangeTime);
    var offset = message.Trigger.Period * message.Trigger.EvaluationPeriods * 1000;
    var metricFilter = metricFilterData.metricFilters[0];
    var parameters = {
        'logGroupName' : metricFilter.logGroupName,
        'filterPattern' : metricFilter.filterPattern ? metricFilter.filterPattern : "",
        'startTime' : timestamp - offset,
        'endTime' : timestamp,
        'nextToken': next_token
    };
    cwl.filterLogEvents(parameters, function (err, data){
        if (err) {
            console.log('Filtering failure:', err);
        } else {
            if (data.events.length == 0){
                if (data.nextToken) {
                    getLogsAndSendMessage(message, metricFilterData, subject, data.nextToken);
                }
                else {
                    var params = {
                        Message:  JSON.stringify(message),
                        TopicArn: topic,
                        Subject: subject,
                    };
                    var publishTextPromise = sns.publish(params).promise();
                    publishTextPromise.then(
                        function(data) {
                            console.log(`Message ${params.Message} send sent to the topic ${params.TopicArn}`);
                        }).catch(
                            function(err) {
                            console.error(err, err.stack);
                        });
                }
            } else {

                if (data.events[0].logStreamName.includes('consulmonitoring')) {
                    generateMessageContentSimple(data, message, metricFilter, metricFilter.logGroupName, timestamp, offset, function(mess) {
                    const repl = String(JSON.stringify(JSON.parse(mess).Trigger.LogErrorPattern).split('=').slice(-1)).replace('\\\"\"', '');
                    const subject_full = String(subject.replace('\" in', ' for SERVICE ' + repl + '\" in').substring(0, 99));
                    var params = {
                        Message:  mess,
                        TopicArn: topic,
                        Subject: subject_full,
                    };
                    var publishTextPromise = sns.publish(params).promise();
                    publishTextPromise.then(
                        function(data) {
                            console.log(`Message ${params.Message} send sent to the topic ${params.TopicArn}`);
                        }).catch(
                            function(err) {
                            console.error(err, err.stack);
                        });
                    });
                } else {
                    const words =  data.events[0].logStreamName.split('_');
                    if (data.events[0].logStreamName.includes('docker')) { var index = 1 } else { var index = 0 }
                    const repl = ' ' +  words.slice(index, words.length-1).join('_') + ' on ' + words.slice(-1);
                    const subject_full = String(subject.replace('\" in', repl + '\" in').substring(0, 99));
                    generateMessageContentFull(data, message, metricFilter, metricFilter.logGroupName, timestamp, offset, function(mess) {
                        var params = {
                            Message:  mess,
                            TopicArn: topic,
                            Subject: subject_full,
                        };
                        var publishTextPromise = sns.publish(params).promise();
                        publishTextPromise.then(
                            function(data) {
                                console.log(`Message ${params.Message} send sent to the topic ${params.TopicArn}`);
                        }).catch(
                            function(err) {
                            console.error(err, err.stack);
                        });
                    });
                }
            }
        }
    });
}

function generateMessageContentSimple(data, message, metricFilter, log_group_name, timestamp, offset, callback) {
    var events = data.events;
    message.Trigger.logStreamName = events[0].logStreamName;
    message.Trigger.logGroupName = log_group_name;
    var parameters = {
        'logGroupName' : metricFilter.logGroupName,
        'filterPattern' : metricFilter.filterPattern ? metricFilter.filterPattern : "",
         'startTime' : timestamp - offset,
         'endTime' : timestamp
    };
    cwl.filterLogEvents(parameters, function (err, data_pattern){
        if (err) {
            console.log('Filtering failure:', err);
        } else {
            message.Trigger.LogErrorPattern = JSON.stringify(events[0].message).replace('\"', '');
            callback(JSON.stringify(message));
        }
    });
}

function generateMessageContentFull(data, message, metricFilter, log_group_name, timestamp, offset, callback) {
    var events = data.events;
    var mess;
    message.Trigger.logStreamName = events[0].logStreamName;
    message.Trigger.logGroupName = log_group_name;
    var parameters = {
        'logGroupName' : metricFilter.logGroupName,
        'filterPattern' : metricFilter.filterPattern ? metricFilter.filterPattern : "",
         'startTime' : timestamp - offset,
         'endTime' : timestamp
    };
    cwl.filterLogEvents(parameters, function (err, data_pattern){
        if (err) {
            console.log('Filtering failure:', err);
        } else {
            message.Trigger.LogErrorPattern = JSON.stringify(events[0].message).replace('\"', '');
            callback(JSON.stringify(message));
        }
    });
    var params_log_event = {
        'logGroupName': log_group_name,
        'logStreamName': events[0].logStreamName,
        'startTime': timestamp - offset,
        'endTime': timestamp,
        'limit': '20'
    };

    cwl.getLogEvents(params_log_event, function(err, data) {
        var i;
        if (err) {
            console.log('Filtering failure:', err);
        } else {
            for (i in data.events) {
                if (data.events[i]) {
                    mess += data.events[i].message + '\n';
                }
            }
            message.Trigger.LogErrorFull = mess;
        }
    });
}
