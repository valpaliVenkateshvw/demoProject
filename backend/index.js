//add user without entry point

const bcrypt = require("bcrypt");

const { dbConfiguration } = require("CommonFunctions/dbWrapper");
// const { awsSesServiceToInviteUsers } = require("../utilities/awsSesFunctionToInviteUsers");
const axios = require("axios");
const { commonSesFunction } = require("CommonFunctions/commonSesFunction");

exports.importUsersConsumer = async (event, context, callback) => {
  let dbConfig;
  let dbresponse;
  let response;
  let localhost
  try {
    const message = JSON.parse(event.Records[0].body);
    // const message = JSON.parse(event.body);

    const { orgDetails } = message;
    // localhost= "http://172.16.10.159:1337";
    localhost = `https://cloud.${orgDetails.tldName}`
    console.log("orgDetails in consumer", orgDetails);
    console.log("import users payload from queue", message);
    // const message = {
    //   firstName: null,
    //   lastName: null,
    //   email: "venkatesh.charla@voltuswave.com",
    //   orgVWID: "c8da47a7-7cef-40c2-af2b-6aa5c2e19e41" ,
    //   tldId: "46dc1524-951d-4b46-b34f-aa2b937fe2fc" ,
    //   clusterId: "ab43e3dc-7184-4b03-971d-8c0167786155",
    //   entryPoints:[],
    // };
    const { extraData, ...user } = message;
    // const stringifyEntryPoints = JSON.stringify({'entryPoints':JSON.stringify(entryPoints)}).replace(/\\/g, "");
    // const stringifyEntryPoints = JSON.stringify(entryPoints);
    const stringifyUser = JSON.stringify(user);
    console.log("string", stringifyUser);
    console.log("extraData:", extraData);

    let dbstatus = false;
    dbConfig = await dbConfiguration();
    dbresponse = await dbConfig.query(
      "select * from vls_get_org_schemes_list($1)",
      [message.orgSchemaId]
    );
    console.log("dbresponse", dbresponse);
    if (
      dbresponse.rows.length > 0 &&
      dbresponse.rows[0].result_json.schemeName &&
      Array.isArray(dbresponse.rows[0].result_json.appWithEntryPoints) &&
      dbresponse.rows[0].result_json.vwpOrgSchemaId
    ) {
      console.log("resultjson", dbresponse.rows[0].result_json);
      console.log("OrgSchemaWorkspaces", dbresponse.rows[0].result_json);
      let entryPoint =
        dbresponse.rows[0].result_json.appWithEntryPoints[0].entryPoints
          .vwp_entry_point_id;
      let vwpEntryPoints = dbresponse.rows[0].result_json.appWithEntryPoints;
      let vwpOrgSchemaId = dbresponse.rows[0].result_json.vwpOrgSchemaId;

      let vls_app_id =
        dbresponse.rows[0].result_json.appWithEntryPoints[0].vls_app_id;
      let appname =
        dbresponse.rows[0].result_json.appWithEntryPoints[0].appName;
      

      //code for add user
      const vwpEntryPoint = vwpEntryPoints.map((entryPoint) => {
        return entryPoint.entryPoints.vwp_entry_point_id;
      });
      console.log("vwpEntryPoint", vwpEntryPoint);
      if (message.isEmailExist) {
        //vwp call  to insert the orgPersonId
        console.log("if condition");

        const vwpPayload = {
          RegNo: 20001,
         
          email: message.email,
          isAdmin: false,
          firstName: message?.firstName,
          lastName: message?.lastName,
          mobileNumber: "0",
          orgCode: orgDetails?.orgCode,
        };

        console.log("vwpPayload", vwpPayload);
        console.log(
          "url",
          `https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}`
        );

        // const vwpResponse = await axios.post(
        //   `https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}`,
        //   vwpPayload
        // );
        //  "localHostTOCloud"
        const vwpResponse = await axios.post(
          `${localhost}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}`,
          vwpPayload
        );
        console.log("vwpResponse", vwpResponse);
        console.log("workSpcesArray", vwpResponse.data.workspacePersonVwpIds)
        let data = vwpResponse.data.data;
        console.log(
          "payload to vls function",

          data?.personLastName,
          data?.email,
          data?.personId
        );
        if (data.email) {
          dbresponse = await dbConfig.query(
            "select * from vls_function_add_org_person($1,$2,$3,$4,$5,$6)",
            [
              orgDetails?.vlsOrgID,
              data?.personFirstName,
              data?.personLastName,
              data?.email,
              data?.personId,
              data.hostName
            ]
          );
          console.log("if condition orgPersonId db response", dbresponse);
          let vlsPersonId = dbresponse.rows[0].platform_user_id;

          dbresponse = await dbConfig.query(
            "select * from services_secret_keys_schema.get_services_secret_keys($1)",
            ["app sync"]
          );
          console.log("dbresponse for get app sync keys:", dbresponse);

          if (dbresponse && dbresponse.rows.length > 0) {
            const keysData = JSON.parse(dbresponse.rows[0]._secret_key);
            const checkAndAddChatEnableResponse = await checkAndAddChatEnable(
              data,
              orgDetails,
              keysData
            );
            console.log(
              "checkAndAddChatEnableResponse",
              checkAndAddChatEnableResponse
            );

            if (checkAndAddChatEnableResponse.addUser) {
              for (let index = 0; index < vwpEntryPoints.length; index++) {
                let appType = ""
                if (appType === "ownerApp") {
                  dbresponse = await dbConfig.query(
                    "select * from vls_functions_assign_subscription_for_ownerapp($1,$2,$3,$4,$5,$6,$7)", //vls_fetch_my_subscription_active_users
                    [
                      data?.hostName,
                      orgDetails?.orgVWID,
                      data?.personId,
                      data?.workspacePersonVwpIds[index].workspaceId,
                      data?.orgPersonVwid,
                      data?.workspacePersonVwpIds[index].workspacePersonVwpId,
                      vwpEntryPoints[index].entryPoints.vwp_entry_point_id,
                    ]
                  );
                  console.log(
                    "dbresponse from owner app susbcription",
                    dbresponse.rows[0]
                  );
                } else {
                  let userDetails = [];

                  let entryPointDetails = {
                    entryPointId:
                      vwpEntryPoints[index].entryPoints.vwp_entry_point_id,
                    appId: data?.workspacePersonVwpIds[index].workspaceId,
                    appName: appname,
                    orgId: orgDetails?.orgVWID,
                    tldId: orgDetails?.tldID,
                  };

                  userDetails.push({
                    firstName: data?.personFirstName,
                    email: data?.email,
                    vlsPersonId: vlsPersonId,
                    hostName: data?.hostName,
                    personId: data?.personId,
                    orgPersonVwid: data?.orgPersonVwid,
                    workspacePersonVwpId:
                      data?.workspacePersonVwpIds[index].workspacePersonVwpId,
                  });
                  console.log(
                    "first",
                    userDetails,
                    "entryPointDetails",
                    entryPointDetails
                  );
                  dbresponse = await dbConfig.query(
                    "select * from vls_functions_subscription_assign_users_list($1,$2)", //vls_fetch_my_subscription_active_users
                    [
                      JSON.stringify(entryPointDetails),
                      JSON.stringify(userDetails),
                    ]
                  );
                  console.log(
                    "dbresponse = ",
                    dbresponse.rows,
                    dbresponse.rows[0]
                  );
                  if (!message.isSilentOnboarding) {
                    if (dbresponse && dbresponse?.rows?.length > 0) {
                      let loginDetails = { vlsPersonId: vlsPersonId };
                      await sendEmailProducer({
                        userParams: userDetails,
                        loginDetails,
                        entryPointDetails,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        //VLS call to insert the orgPersonId
      } else {
        console.log("else condition");
        if (message.isSilentOnboarding) {
          console.log("in silent onboard for new user");
          const vwpPayload = {
            reg: "sdfdsf",
            countryCode: "",
            domainName: orgDetails.tldName,
            email: message.email,
            isAdmin: false,
            firstName: message?.firstName,
            lastName: message?.lastName,
            mobileNumber: "0",
            orgCode: orgDetails?.orgCode,
            orgId: orgDetails?.orgVWID,
            orgName: orgDetails?.orgName,
            password: message?.password,
            isNewUser: true,
            orgSchemeId: vwpOrgSchemaId,
            entryPointList: vwpEntryPoint,
          };

          console.log("vwpPayload", vwpPayload);
          //  "localHostTOCloud"
          // const vwpResponse = await axios.post(
          //   `https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}&entryPointId=${vwpEntryPoints[index].entryPoints.vwp_entry_point_id}`,
          //   vwpPayload
          // );
          const vwpResponse = await axios.post(
            `${localhost}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}`,
            vwpPayload
          );

          console.log("vwpResponse", vwpResponse);
          console.log("workSpcesArray", vwpResponse.data.workspacePersonVwpIds)
          //VLS call to insert the orgPersonId
          const { data } = vwpResponse.data;
          console.log(
            "payload to vls function",
            orgDetails?.vlsOrgID,
            data?.personFirstName,
            data?.personLastName,
            data?.email,
            data?.personId,
            data?.orgPersonVwid
          );

          if (data.email) {
            dbresponse = await dbConfig.query(
              "select * from vls_function_add_org_person($1,$2,$3,$4,$5,$6)",
              [
                orgDetails?.vlsOrgID,
                "",
                message?.lastName,
                data?.email,
                data?.personId,
                data?.orgPersonVwid,
              ]
            );
            console.log("if condition orgPersonId db response", dbresponse);
            let vlsPersonId = dbresponse.rows[0].platform_user_id;

            dbresponse = await dbConfig.query(
              "select * from services_secret_keys_schema.get_services_secret_keys($1)",
              ["app sync"]
            );
            console.log("dbresponse for get app sync keys:", dbresponse);

            if (dbresponse && dbresponse.rows.length > 0) {
              const keysData = JSON.parse(dbresponse.rows[0]._secret_key);
              const checkAndAddChatEnableResponse = await checkAndAddChatEnable(
                data,
                orgDetails,
                keysData
              );
              console.log(
                "checkAndAddChatEnableResponse",
                checkAndAddChatEnableResponse
              );

              if (true) {
                //checkAndAddChatEnableResponse.addUser
                const hashedPassword = await bcrypt.hash(message.password, 10);
                console.log("input for add new user", [
                  message?.firstName,
                  message?.lastName,
                  message.email,
                  "",
                  hashedPassword,
                  orgDetails.tldID,
                  orgDetails?.orgVWID,
                  data?.personId,
                  data?.orgPersonVwid,
                ]);
                dbresponse = await dbConfig.query(
                  "select * from vls_admin_create_users($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                  [
                    message?.firstName,
                    message?.lastName,
                    message.email,
                    "",
                    hashedPassword,
                    orgDetails.tldID,
                    orgDetails?.orgVWID,
                    data?.personId,
                    data?.orgPersonVwid,
                  ]
                );
                console.log("dbresponse from create user:", dbresponse);

                for (let index = 0; index < vwpEntryPoints.length; index++) {
                  let appType = vwpEntryPoints[index].appType;
                  console.log("appType", appType);
                  if (appType === "ownerApp") {
                    console.log("in owner app ");
                    dbresponse = await dbConfig.query(
                      "select * from vls_functions_assign_subscription_for_ownerapp($1,$2,$3,$4,$5,$6,$7)", //vls_fetch_my_subscription_active_users
                      [
                        data?.hostName,
                        orgDetails?.orgVWID,
                        data?.personId,
                        data?.workspacePersonVwpIds[index].workspaceId,
                        data?.orgPersonVwid,
                        data?.workspacePersonVwpIds[index].workspacePersonVwpId,
                        vwpEntryPoints[index].entryPoints.vwp_entry_point_id,
                      ]
                    );
                    console.log(
                      "dbresponse from owner app susbcription",
                      dbresponse.rows[0]
                    );
                  } else {
                    let userDetails = [];

                    let entryPointDetails = {
                      entryPointId:
                        vwpEntryPoints[index].entryPoints.vwp_entry_point_id,
                      appId: data?.workspacePersonVwpIds[index].workspaceId,
                      appName: appname,
                      orgId: orgDetails?.orgVWID,
                      tldId: orgDetails?.tldID,
                    };

                    userDetails.push({
                      firstName: data?.personFirstName,
                      email: data?.email,
                      vlsPersonId: vlsPersonId,
                      hostName: data?.hostName,
                      personId: data?.personId,
                      orgPersonVwid: data?.orgPersonVwid,
                      workspacePersonVwpId:
                        data?.workspacePersonVwpIds[index].workspacePersonVwpId,
                    });
                    console.log(
                      "first",
                      userDetails,
                      "entryPointDetails",
                      entryPointDetails
                    );
                    dbresponse = await dbConfig.query(
                      "select * from vls_functions_subscription_assign_users_list($1,$2)", //vls_fetch_my_subscription_active_users
                      [
                        JSON.stringify(entryPointDetails),
                        JSON.stringify(userDetails),
                      ]
                    );
                    console.log(
                      "dbresponse = ",
                      dbresponse.rows,
                      dbresponse.rows[0]
                    );
                    if (!message.isSilentOnboarding) {
                      if (dbresponse && dbresponse?.rows?.length > 0) {
                        let loginDetails = { vlsPersonId: vlsPersonId };
                        await sendEmailProducer({
                          userParams: userDetails,
                          loginDetails,
                          entryPointDetails,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        } else {
          for (let i = 1; i <= 3; i++) {
            dbresponse = await dbConfig.query(
              "select * from vls_function_add_user_app_entrypoint_details_new($1)",
              [stringifyUser]
            );
            console.log(
              "else condition consumer dbresponse",
              JSON.stringify(dbresponse)
            );
            if (dbresponse.rows.length > 0) {
              dbstatus = true;
              break;
            }
          }

          if (dbstatus) {
            const payload = {
              emailId: dbresponse.rows[0]._email,
              orgId: dbresponse.rows[0]._vwp_orgid,
              tldId: dbresponse.rows[0]._tld_id,
              userId: dbresponse.rows[0]._vls_person_id,
              name: `${dbresponse.rows[0]?._firstname} ${dbresponse.rows[0]?._lastname}`,
              orgName: dbresponse.rows[0]._org_name,
              orgAdmin: `${dbresponse.rows[0]?._org_admin_firstname} ${dbresponse.rows[0]?._org_admin_lastname}`,
              hostName: orgDetails.tldName,
              // entryPoint: dbresponse.rows[0]._platform_user_entrypoint_id[0],
            };

            // console.log("payload in import", payload, dbresponse.rows[0], dbresponse.rows[0]._tld_id);
            // console.log(JSON.stringify(dbresponse.rows[0]));
            // const emailInviteResponse = await awsSesServiceToInviteUsers(payload);
            // console.log("again into the sqs", emailInviteResponse.status);

            const { tldId, userId, emailId } = payload;

            //sending mail through
            const emailTemplateResponse = await dbConfig.query(
              "select * from vls_template4($1)",
              [
                JSON.stringify({
                  _platform_id: tldId,
                  _platform_user_id: extraData.vlsPersonId,
                  _user_id: userId,
                  _event_id: 4,
                  _vls_org_id: orgDetails.vlsOrgID,
                  _org_schema_id: message.orgSchemaId,
                }),
              ]
            );

            console.log(
              "invite user emailTemplateResponse:",
              emailTemplateResponse.rows[0].vls_template4
            );

            const {
              _template_name,
              _template_logo,
              _user_onboarding_url,
              _platform_name,
              _platform_endpoint,
              _platform_url,
              _platform_email,
              _platform_logo,
              _platform_facebook,
              _platform_instagram,
              _platform_linkedin,
              _platform_privacy_policy,
              _button_text,
              _org_admin_name,
              _org_name,
              _subdomain_code,
              _org_logo,
              _org_email,
              _org_url,
              _org_privacy_policy_url,
              _org_facebook_url,
              _org_instagram_url,
              _org_linkedin_url
            } = emailTemplateResponse.rows[0].vls_template4;

            const emailTemplateData = {
              platformURL: _org_url || "",
              platformLogo: _org_logo || "",
              templateLogo: _template_logo || "",
              orgAdmin: _org_admin_name || "",
              orgName: _org_name || "",
              buttonContext: _button_text || "",
              userOnboardingURL: _user_onboarding_url || "",
              privacyPolicyLink: _org_privacy_policy_url || "",
              fbLink: _org_facebook_url || "",
              instaLink: _org_instagram_url || "",
              platFormName: _platform_endpoint || "",
              linkedInLink: _org_linkedin_url || "",
            };
            console.log({ emailTemplateData });

            const sqsPayload = [
              {
                templateName: _template_name,
                fromEmail: _org_email,
                templateData: emailTemplateData,
                toEmail: emailId,
              },
            ];

            const responseFromCommonsqsFunction = await commonSesFunction({
              payload: sqsPayload,
            });
            console.log(
              "responseFromCommonsqsFunction",
              responseFromCommonsqsFunction
            );
            //sending mail through

            if (responseFromCommonsqsFunction.status === 200) {
              return {
                statusCode: 200,
                headers: {
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Credentials": true,
                },
                body: "",
              };
            } else {
              return {
                statusCode: 400,
                headers: {
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Credentials": true,
                },
                body: "",
              };
            }
          } else {
            // return {
            //   statusCode: 400,
            //   headers: {
            //     "Access-Control-Allow-Origin": "*",
            //     "Access-Control-Allow-Credentials": true,
            // },
            //   body:""
            // };
            callback(
              null,
              (response = {
                statusCode: 200,
                headers: {
                  "Access-Control-Allow-Origin": "*",
                  "Access-Control-Allow-Credentials": true,
                },
                body: JSON.stringify({
                  message: "success",
                  status: 200,
                  orgApps: [
                    {
                      body: "",
                    },
                  ],
                }),
              })
            );
          }
        }
      }
    } else {
      console.log("invaid schema from db", dbresponse.rows);
    }
    callback(
      null,
      (response = {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Credentials": true,
        },
        body: JSON.stringify({
          message: "success",
          status: 200,
          orgApps: [
            {
              body: "",
            },
          ],
        }),
      })
    );
  } catch (error) {
    console.log("error", error);
    // return {
    //   statusCode: 400,
    //   headers: {
    //     "Access-Control-Allow-Origin": "*",
    //     "Access-Control-Allow-Credentials": true,
    // },
    //   body:""
    // };
    callback(
      null,
      (response = {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Credentials": true,
        },
        body: JSON.stringify({
          message: "success",
          status: 200,
          orgApps: [
            {
              body: "",
            },
          ],
        }),
      })
    );
  } finally {
    console.log("lambda log", dbresponse);
    await dbConfig.end();
  }
};

// checking and adding invite users chat ability for EXISTING USERS FROM ANOTHER ORG :
async function checkAndAddChatEnable(data, orgDetails, keysData) {
  console.log("checkAndAddChatEnable data", data, orgDetails, keysData);
  try {
    const graphqlUrl = keysData.awsappsyncgraphqlEndpoint;

    const headers = {
      "x-api-key": keysData.awsappsyncapiKey,
      "Content-Type": "application/json",
    };

    const query = `
    query ($user_id : ID!,$origin_id : String!) {
      userIDExists(user_id: $user_id,origin_id : $origin_id)
    }
    `;

    const variables = {
      user_id: data.orgPersonVwid,
      origin_id: `${orgDetails.tldID}_${orgDetails.orgVWID}`,
    };

    const res = await axios({
      url: graphqlUrl,
      method: "post",
      headers,
      data: {
        query: query,
        variables: variables,
      },
    });
    console.log("userIdExistResponse", res);
    if (!res.data.data.userIDExists) {
      const query = `
      mutation ($user_name : String!,$user_id : ID!,$org_id : String!,$tld_id : String!,$email_id : String! ) {
        addUser(input : {user_name: $user_name,user_id : $user_id,org_id : $org_id,tld_id : $tld_id,email_id : $email_id}) {
          user_id     
          user_name
          email_id
        }
      }`;

      const variables = {
        user_name: data.personFirstName,
        user_id: data.orgPersonVwid,
        org_id: orgDetails.orgVWID,
        tld_id: orgDetails.tldID,
        email_id: data.email,
      };

      const addUserChatEnableResponse = await axios({
        url: graphqlUrl,
        method: "post",
        headers,
        data: {
          query: query,
          variables: variables,
        },
      });
      console.log(
        "addUserChatEnableResponse:",
        addUserChatEnableResponse.data.data
      );
      return addUserChatEnableResponse.data.data;
    }
  } catch (error) {
    console.log("check and add catch error", error);
  }
}

async function sendEmailProducer({
  userParams,
  loginDetails,
  entryPointDetails,
}) {
  console.log("send email data :", userParams, loginDetails, entryPointDetails);
  let dbConfig;

  try {
    dbConfig = await dbConfiguration();
    const assignUsersTemplateResponse = await dbConfig.query(
      "select * from vls_template9($1)",
      [
        JSON.stringify({
          _platform_id: entryPointDetails.tldId,
          _platform_user_id: loginDetails.vlsPersonId,
          _app_id: entryPointDetails.vlsAppId,
          _event_id: 9,
        }),
      ]
    );
    console.log("assignUsersTemplateResponse:", assignUsersTemplateResponse);

    const {
      _template_id,
      _template_name,
      _template_logo,
      _account_login,
      _platform_name,
      _platform_endpoint,
      _platform_url,
      _platform_email,
      _platform_logo,
      _facebook,
      _instagram,
      _linkedin,
      _privacy_policy,
      _button_text,
      _apple_playstore_url,
      _google_playstore_url,
      _admin_name,
      _email_id,
      _subdomain_code,
      _app_name,
    } = assignUsersTemplateResponse.rows[0];

    const assignUserTemplateData = {
      platformURL: _platform_url || " ",
      platformLogo: _platform_logo || " ",
      adminName: _admin_name || " ",
      appName: _app_name || " ",
      vwpAccountURL: _account_login || " ",
      buttonContext: _button_text || " ",
      platformName: _platform_name || " ",
      googlePlayStore: _google_playstore_url || " ",
      applePlayStore: _apple_playstore_url || " ",
      privacyPolicyLink: _privacy_policy || " ",
      platformEndPoint: _platform_endpoint || " ",
      fbLink: _facebook || " ",
      instaLink: _instagram || " ",
      linkedInLink: _linkedin || " ",
    };

    const arrayOfObjectsForOrgUsers = userParams.map((each) => {
      // const payload = {
      //  userDetails: each,
      //  loginDetails,
      //  orgUrl,
      //  appName,
      // };

      return {
        templateName: _template_name,
        fromEmail: _platform_email,
        templateData: assignUserTemplateData,
        toEmail: each.email,
      };
    });

    const sqsResponse = await commonSesFunction({
      payload: arrayOfObjectsForOrgUsers,
    }); // it is pushing to the sqs genric queue
    console.log("sqsResponse for user assign", sqsResponse);

    // AWS.config.update({ region: "us-east-1" });
    // const sqs = new AWS.SQS({ apiVersion: "2012-11-05" });

    // const queueUrl = constants.subscribedUsersQueue; // poisitive flow queue for storing
    // const deadQueueUrl = constants.subscribedUsersDeadLetterQueue; // failed flow queue

    // console.log("userDetails in producer", userParams);

    // try {
    //   console.log("email");
    //   for (let i = 0; i < userParams.length; i++) {
    //     const userDetails = userParams[i];
    //     const payload = {
    //       userDetails,
    //       loginDetails,
    //       orgUrl,
    //       appName,
    //     };
    //     const params = {
    //       MessageBody: JSON.stringify(payload),
    //       QueueUrl: queueUrl,
    //       MessageGroupId: uuidv4(),
    //       MessageDeduplicationId: uuidv4(),
    //     };

    //     const promiseRes = await sqs.sendMessage(params).promise();
    //     console.log(promiseRes);
    //   }

    // callback(null, {
    //   statusCode: 200,
    //   headers: {
    //     "Access-Control-Allow-Origin": "*",
    //     "Access-Control-Allow-Credentials": true,
    //   },
    //   body: JSON.stringify({
    //     status: 200,
    //     message: "users added to the queue",
    //   }),
    // });
  } catch (error) {
    console.log("error", error);
    const body = {
      //   time: moment(),
      handler: "",
      message: error,
      params: { userParams, loginDetails },
    };

    const params = {
      MessageBody: JSON.stringify(body),
      QueueUrl: deadQueueUrl,
      MessageGroupId: uuidv4(),
      MessageDeduplicationId: uuidv4(),
    };

    sqs.sendMessage(params, (err, data) => {
      if (err) {
        console.log(`Error sending message :${err}`);
      } else {
        console.log(`sending message ${data}`);
      }
    });

    // callback(null, {
    //   statusCode: 400,
    //   headers: {
    //     "Access-Control-Allow-Origin": "*",
    //     "Access-Control-Allow-Credentials": true,
    //   },
    //   body: JSON.stringify({
    //     error: error,
    //   }),
    // });
  } finally {
    await dbConfig.end();
  }
}

//vwp call  to insert the orgPersonId
// console.log("if condition");
// const vwpPayload = {
//  RegNo: 20001,
//  countryCode: "",
//  domainName: orgDetails.tldName,
//  email: message.email,
//  isAdmin: false,
//  lastName: message.lastName,
//  mobileNumber: "0",
//  orgCode: orgDetails.orgCode,
//  orgId: orgDetails.orgVWID,
// };

// console.log("vwpPayload", vwpPayload);
// const vwpResponse = await axios.post(`https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite`, vwpPayload);

// console.log("vwpResponse", vwpResponse);
// //VLS call to insert the orgPersonId
// const { data } = vwpResponse.data;
// console.log("payload to vls function", orgDetails?.vlsOrgID, data?.personFirstName, data?.personLastName, data?.email, data?.personId, data?.orgPersonVwid);

// if (data.email) {
//  dbresponse = await dbConfig.query("select * from vls_function_add_org_person($1,$2,$3,$4,$5,$6)", [
//      orgDetails?.vlsOrgID,
//      data?.personFirstName,
//      data?.personLastName,
//      data?.email,
//      data?.personId,
//      data?.orgPersonVwid,
//  ]);

//  console.log("if condition orgPersonId db response", dbresponse);

//  dbresponse = await dbConfig.query("select * from services_secret_keys_schema.get_services_secret_keys($1)", ["app sync"]);
//  console.log("dbresponse for get app sync keys:", dbresponse);

//  if (dbresponse && dbresponse.rows.length > 0) {
//      const keysData = JSON.parse(dbresponse.rows[0]._secret_key);
//      const checkAndAddChatEnableResponse = await checkAndAddChatEnable(data, orgDetails, keysData);
//      console.log("checkAndAddChatEnableResponse", checkAndAddChatEnableResponse);

//      if (checkAndAddChatEnableResponse.addUser) {
//          const addUserInviteMailPayLoads = [];

//          const dbResponse = await dbConfig.query("select * from vls_fetch_tld_id($1)", [orgDetails.vlsOrgID]);
//          console.log("get tld response : ", dbResponse);

//          const objectForUsers = {
//              templateName: "addUserInvitationTemplateForUser",
//              subject: "Voltuswave Account Enrollment",
//              templateData: {
//                  accountAdmin: message?.orgDetails?.primaryAdminName,
//                  accountName: message?.orgDetails?.orgName,
//                  userName: `${message?.firstName} ${message?.lastName}`,
//                  userEmail: message?.email,
//                  accountURL: dbResponse?.rows[0]?._main_tld_,
//              },
//              toEmail: message?.email,
//          };

//          const objectForAdmin = {
//              templateName: "addUserInvitationTemplateForAdmin",
//              subject: "Voltuswave Account Enrollment",
//              templateData: {
//                  userName: `${message?.firstName} ${message?.lastName}`,
//                  userEMail: message?.email,
//              },
//              toEmail: message?.orgDetails?.primaryAdminEmail,
//          };

//          addUserInviteMailPayLoads.push(objectForUsers, objectForAdmin);

//          const addUsersEmailResponse = await commonSesFunction({
//              payload: addUserInviteMailPayLoads,
//          });

//          console.log({ addUsersEmailResponse });
//      }
//  }
// }

//is email exist code
// //vwp call  to insert the orgPersonId
// console.log("if condition");
// const vwpPayload = {
//  RegNo: 20001,
//  countryCode: "",
//  domainName: orgDetails.tldName,
//  email: message.email,
//  isAdmin: false,
//  lastName: message.lastName,
//  mobileNumber: "0",
//  orgCode: orgDetails.orgCode,
//  orgId: orgDetails.orgVWID,
// };

// console.log("vwpPayload", vwpPayload);
// const vwpResponse = await axios.post(`https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite`, vwpPayload);

// console.log("vwpResponse", vwpResponse);
// //VLS call to insert the orgPersonId
// const { data } = vwpResponse.data;
// console.log("payload to vls function", orgDetails?.vlsOrgID, data?.personFirstName, data?.personLastName, data?.email, data?.personId, data?.orgPersonVwid);

// if (data.email) {
//  dbresponse = await dbConfig.query("select * from vls_function_add_org_person($1,$2,$3,$4,$5,$6)", [
//      orgDetails?.vlsOrgID,
//      data?.personFirstName,
//      data?.personLastName,
//      data?.email,
//      data?.personId,
//      data?.orgPersonVwid,
//  ]);

//  console.log("if condition orgPersonId db response", dbresponse);

//  dbresponse = await dbConfig.query("select * from services_secret_keys_schema.get_services_secret_keys($1)", ["app sync"]);
//  console.log("dbresponse for get app sync keys:", dbresponse);

//  if (dbresponse && dbresponse.rows.length > 0) {
//      const keysData = JSON.parse(dbresponse.rows[0]._secret_key);
//      const checkAndAddChatEnableResponse = await checkAndAddChatEnable(data, orgDetails, keysData);
//      console.log("checkAndAddChatEnableResponse", checkAndAddChatEnableResponse);

//      if (checkAndAddChatEnableResponse.addUser) {
//          const addUserInviteMailPayLoads = [];

//          const dbResponse = await dbConfig.query("select * from vls_fetch_tld_id($1)", [orgDetails.vlsOrgID]);
//          console.log("get tld response : ", dbResponse);

//          const objectForUsers = {
//              templateName: "addUserInvitationTemplateForUser",
//              subject: "Voltuswave Account Enrollment",
//              templateData: {
//                  accountAdmin: message?.orgDetails?.primaryAdminName,
//                  accountName: message?.orgDetails?.orgName,
//                  userName: `${message?.firstName} ${message?.lastName}`,
//                  userEmail: message?.email,
//                  accountURL: dbResponse?.rows[0]?._main_tld_,
//              },
//              toEmail: message?.email,
//          };

//          const objectForAdmin = {
//              templateName: "addUserInvitationTemplateForAdmin",
//              subject: "Voltuswave Account Enrollment",
//              templateData: {
//                  userName: `${message?.firstName} ${message?.lastName}`,
//                  userEMail: message?.email,
//              },
//              toEmail: message?.orgDetails?.primaryAdminEmail,
//          };

//          addUserInviteMailPayLoads.push(objectForUsers, objectForAdmin);

//          const addUsersEmailResponse = await commonSesFunction({
//              payload: addUserInviteMailPayLoads,
//          });

//          console.log({ addUsersEmailResponse });
//      }
//  }
// }

// const { extraData, ...user } = message;
//      // const stringifyEntryPoints = JSON.stringify({'entryPoints':JSON.stringify(entryPoints)}).replace(/\\/g, "");
//      // const stringifyEntryPoints = JSON.stringify(entryPoints);
//      const stringifyUser = JSON.stringify(user);
//      console.log("string", stringifyUser);
//      console.log("extraData:", extraData);

// else if (message.userType == "ownerAppUser") {
//   console.log("ownerAppUser flow");
//   //code for app user
//   if (message.isEmailExist) {
//     //vwp call  to insert the orgPersonId
//     console.log("if condition ownerAppUser flow");
//     const vwpPayload = {
//       RegNo: 20001,
//       countryCode: "",
//       domainName: orgDetails.tldName,
//       email: message.email,
//       isAdmin: false,
//       firstName: message?.firstName,
//       lastName: message?.lastName,
//       mobileNumber: "0",
//       orgCode: orgDetails?.orgCode,
//       orgId: orgDetails?.orgVWID,
//       orgName: orgDetails?.name,
//     };

//     console.log("vwpPayload", vwpPayload);
//     console.log(
//       "url",
//       `https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}`
//     );
//     const vwpResponse = await axios.post(
//       `https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}`,
//       vwpPayload
//     );

//     console.log("vwpResponse", vwpResponse);
//     //VLS call to insert the orgPersonId
//     const { data } = vwpResponse.data;
//     console.log(
//       "payload to vls function",
//       orgDetails?.vlsOrgID,
//       data?.personFirstName,
//       data?.personLastName,
//       data?.email,
//       data?.personId,
//       data?.orgPersonVwid
//     );

//     dbresponse = await dbConfig.query(
//       "select * from vls_function_add_org_person($1,$2,$3,$4,$5,$6)",
//       [
//         orgDetails?.vlsOrgID,
//         data?.personFirstName,
//         data?.personLastName,
//         data?.email,
//         data?.personId,
//         data?.orgPersonVwid,
//       ]
//     );
//     console.log("if condition orgPersonId db response", dbresponse);
//     let vlsPersonId = dbresponse.rows[0].platform_user_id;

//     dbresponse = await dbConfig.query(
//       "select * from services_secret_keys_schema.get_services_secret_keys($1)",
//       ["app sync"]
//     );
//     console.log("dbresponse for get app sync keys:", dbresponse);

//     if (dbresponse && dbresponse.rows.length > 0) {
//       const keysData = JSON.parse(dbresponse.rows[0]._secret_key);
//       const checkAndAddChatEnableResponse = await checkAndAddChatEnable(
//         data,
//         orgDetails,
//         keysData
//       );
//       console.log(
//         "checkAndAddChatEnableResponse",
//         checkAndAddChatEnableResponse
//       );

//       //call for owner app user

//       const vwpPayload = {
//         selectedPersons: [
//           {
//             emailId: message.email,
//             personEmail: [
//               {
//                 vwid: data?.personId,
//               },
//             ],
//           },
//         ],
//         workspaceId: message.selectedAppData.vwpAppId,
//         userTypeId: message?.vwpUserTypeId,
//         orgId: orgDetails?.orgVWID,
//         isAccountLogin: null,
//         loggedInPersonVwpId: "",
//         subDomainCode: orgDetails.orgCode,
//         domainUrl: "",
//       };

//       console.log("AssingUserToAppService body", vwpPayload);
//       console.log(
//         "url",
//         `https://cloud.${orgDetails.tldName}/AddOwnerOrgPersonToWorkspace`
//       );
//       const response = await axios.post(
//         `https://cloud.${orgDetails.tldName}/AddOwnerOrgPersonToWorkspace`,
//         vwpPayload
//       );
//       console.log("AssingUserToAppHandler vwp resp", response);

//       const userDetails = response.data.data.addedWorkspacePersons.map(
//         (each, i) => ({
//           email: each.email,
//           orgPersonVwid: data?.orgPersonVwid,
//           workspacePersonVwpId: each.workspacePersonVwid,
//           vlsPersonId: vlsPersonId,
//         })
//       );
//       const vlsPayload = {
//         userDetails: userDetails,
//         entryPointDetails: {
//           appId: message.selectedAppData.vwpAppId,
//           appName: message.selectedAppData.appName,
//           orgId: orgDetails.orgVWID,
//           tldId: orgDetails.tldID,
//         },
//       };
//       console.log("vlsPayload", vlsPayload);
//       console.log("calling vls api");

//       dbresponse = await dbConfig.query(
//         "select * from vls_functions_add_app_users_for_owner_app($1,$2)", //vls_fetch_my_subscription_active_users
//         [
//           JSON.stringify(vlsPayload.entryPointDetails),
//           JSON.stringify(vlsPayload.userDetails),
//         ]
//       );
//       console.log("ownerAppVlsDbResponse", dbresponse);
//       //call for owner app user

//       if (!message.isSilentOnboarding) {
//         if (dbresponse && dbresponse?.rows?.length > 0) {
//           let loginDetails = { vlsPersonId: vlsPersonId };
//           //   await sendEmailProducer({
//           //     userParams: "",
//           //     loginDetails,
//           //     entryPointDetails:"",
//           //   });
//         }
//       }
//     }
//   } else {
//     console.log("else condition");
//     if (message.isSilentOnboarding) {
//       console.log("in silent onboard for new user");
//       const vwpPayload = {
//         RegNo: 20001,
//         countryCode: "",
//         domainName: orgDetails.tldName,
//         email: message.email,
//         isAdmin: false,
//         firstName: message?.firstName,
//         lastName: message?.lastName,
//         mobileNumber: "0",
//         orgCode: orgDetails?.orgCode,
//         orgId: orgDetails?.orgVWID,
//         orgName: orgDetails?.orgName,
//         password: message?.password,
//         isNewUser: true,
//       };

//       console.log("vwpPayload", vwpPayload);
//       console.log(
//         "url",
//         `https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}`
//       );
//       const vwpResponse = await axios.post(
//         `https://cloud.${orgDetails.tldName}/onboardingSignup?signupType=invite&tldId=${orgDetails.tldID}`,
//         vwpPayload
//       );

//       console.log("vwpResponse", vwpResponse);
//       //VLS call to insert the orgPersonId
//       const { data } = vwpResponse.data;
//       console.log(
//         "payload to vls function",
//         orgDetails?.vlsOrgID,
//         data?.personFirstName,
//         data?.personLastName,
//         data?.email,
//         data?.personId,
//         data?.orgPersonVwid
//       );

//       if (data.email) {
//         dbresponse = await dbConfig.query(
//           "select * from vls_function_add_org_person($1,$2,$3,$4,$5,$6)",
//           [
//             orgDetails?.vlsOrgID,
//             message?.firstName,
//             message?.lastName,
//             data?.email,
//             data?.personId,
//             data?.orgPersonVwid,
//           ]
//         );
//         let vlsPersonId = dbresponse.rows[0].platform_user_id;
//         console.log("if condition orgPersonId db response", dbresponse);

//         dbresponse = await dbConfig.query(
//           "select * from services_secret_keys_schema.get_services_secret_keys($1)",
//           ["app sync"]
//         );
//         console.log("dbresponse for get app sync keys:", dbresponse);

//         if (dbresponse && dbresponse.rows.length > 0) {
//           const keysData = JSON.parse(dbresponse.rows[0]._secret_key);
//           const checkAndAddChatEnableResponse =
//             await checkAndAddChatEnable(data, orgDetails, keysData);
//           console.log(
//             "checkAndAddChatEnableResponse",
//             checkAndAddChatEnableResponse
//           );

//           if (true) {
//             //checkAndAddChatEnableResponse.addUser
//             const hashedPassword = await bcrypt.hash(
//               message.password,
//               10
//             );
//             console.log("input for add new user", [
//               message?.firstName,
//               message?.lastName,
//               message.email,
//               "",
//               hashedPassword,
//               orgDetails.tldID,
//               orgDetails?.orgVWID,
//               data?.personId,
//               data?.orgPersonVwid,
//             ]);
//             dbresponse = await dbConfig.query(
//               "select * from vls_admin_create_users($1,$2,$3,$4,$5,$6,$7,$8,$9)",
//               [
//                 message?.firstName,
//                 message?.lastName,
//                 message.email,
//                 "",
//                 hashedPassword,
//                 orgDetails.tldID,
//                 orgDetails?.orgVWID,
//                 data?.personId,
//                 data?.orgPersonVwid,
//               ]
//             );
//             console.log("dbresponse from create user:", dbresponse);
//             // subscribe to owner app for silent onboarding
//             if (dbresponse && dbresponse.rows.length > 0) {
//               const vwpPayload = {
//                 selectedPersons: [
//                   {
//                     emailId: message.email,
//                     personEmail: [
//                       {
//                         vwid: data?.personId,
//                       },
//                     ],
//                   },
//                 ],
//                 workspaceId: message.selectedAppData.vwpAppId,
//                 userTypeId: message?.vwpUserTypeId,
//                 orgId: orgDetails?.orgVWID,
//                 isAccountLogin: null,
//                 loggedInPersonVwpId: "",
//                 subDomainCode: orgDetails.orgCode,
//                 domainUrl: "",
//               };

//               console.log("AssingUserToAppService body", vwpPayload);
//               console.log(
//                 "url",
//                 `https://cloud.${orgDetails.tldName}/AddOwnerOrgPersonToWorkspace`
//               );
//               const response = await axios.post(
//                 `https://cloud.${orgDetails.tldName}/AddOwnerOrgPersonToWorkspace`,
//                 vwpPayload
//               );
//               console.log("AssingUserToAppHandler vwp resp", response);

//               const userDetails =
//                 response.data.data.addedWorkspacePersons.map(
//                   (each, i) => ({
//                     email: each.email,
//                     orgPersonVwid: data?.orgPersonVwid,
//                     workspacePersonVwpId: each.workspacePersonVwid,
//                     vlsPersonId: vlsPersonId,
//                   })
//                 );
//               const vlsPayload = {
//                 userDetails: userDetails,
//                 entryPointDetails: {
//                   appId: message.selectedAppData.vwpAppId,
//                   appName: message.selectedAppData.appName,
//                   orgId: orgDetails.orgVWID,
//                   tldId: orgDetails.tldID,
//                 },
//               };
//               console.log("vlsPayload", vlsPayload);
//               console.log("calling vls api");

//               dbresponse = await dbConfig.query(
//                 "select * from vls_functions_add_app_users_for_owner_app($1,$2)", //vls_fetch_my_subscription_active_users
//                 [
//                   JSON.stringify(vlsPayload.entryPointDetails),
//                   JSON.stringify(vlsPayload.userDetails),
//                 ]
//               );
//               console.log("ownerAppVlsDbResponse", dbresponse);
//               //call for owner app user

//               if (!message.isSilentOnboarding) {
//                 if (dbresponse && dbresponse?.rows?.length > 0) {
//                   let loginDetails = { vlsPersonId: vlsPersonId };
//                   //   await sendEmailProducer({
//                   //     userParams: "",
//                   //     loginDetails,
//                   //     entryPointDetails:"",
//                   //   });
//                 }
//               }
//             }
//           }
//         }
//       }
//     } else {
//       for (let i = 1; i <= 3; i++) {
//         dbresponse = await dbConfig.query(
//           "select * from vls_function_add_user_app_entrypoint_details_new($1)",
//           [stringifyUser]
//         );
//         console.log(
//           "else condition consumer dbresponse",
//           JSON.stringify(dbresponse)
//         );
//         if (dbresponse.rows.length > 0) {
//           dbstatus = true;
//           break;
//         }
//

//         // console.log("payload in import", payload, dbresponse.rows[0], dbresponse.rows[0]._tld_id);
//         // console.log(JSON.stringify(dbresponse.rows[0]));
//         // const emailInviteResponse = await awsSesServiceToInviteUsers(payload);
//         // console.log("again into the sqs", emailInviteResponse.status);