'use strict';
const Alexa = require('alexa-sdk');
const awsSDK = require('aws-sdk');
const thesaurus = require('thesaurus-com');
const itemsTableName = 'Items';
const timeStampTableName = 'TimeStamp';
const activeListTableName = 'ActiveList';
const documentClient = new awsSDK.DynamoDB.DocumentClient();
const documentClientNew = new awsSDK.DynamoDB.DocumentClient();
let activeListFetchedStatus = false;

//this activeList is filled up at the beginning of the program and emptied at the exit of the program
let activeList = [];

//function to fetch activeList at the beginning of the start of Alexa
function fetchActiveListAndCache(userId) {
  const params = {
    TableName: activeListTableName,
    Key: {
      "userId": userId
    }
  };
  documentClient.get(params, function (err, data) {
    if(err) {
      console.log("oops! activeList couldn't be fetched", err);
    } else {
      console.log('activeList has been cached');
      activeListFetchedStatus = true;
      activeList = data.Item.activeList;
    }
  })
}

//stores the activeList back into the ActiveList table after the program comes to a halt
function storeActiveList(userId) {
  const params = {
    TableName: activeListFetchedStatus,
    Item: {
      "userId": userId,
      "activeList": activeList
    }
  };
  documentClient.put(params, function (err, data) {
    if(err) {
      console.log("activeList couldn't be stored");
    } else {
      console.log("activeList has been stored", data);
    }
  })
}

function moveFromActiveListToDB(userId, item) {
  const params = {
    TableName: itemsTableName,
    Item:{
      "itemName-userId": item.itemName + "-" + userId,
      "userId": userId,
      "itemName": item.itemName,
      "locationName": item.locationName
    }
  };

  documentClient.put(params, function(err, data) {
    if (err) {
      console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
    } else {
      console.log("Added item to the database:", JSON.stringify(data, null, 2));
    }
  });
}

//function to filter out the unnecessary synonyms
function filterSynonyms(synonyms) {
  //todo: this function is to be implemented
  return synonyms;
}

const handlers = {

  'FindItemIntent': function () {
    let emitCopy = this.emit;
    const { userId } = this.event.session.user;
    const { slots } = this.event.request.intent;

    //fetch activeList if not yet
    if(!activeListFetchedStatus) {
      fetchActiveListAndCache(userId);
    }

    //name of the item
    if (!slots.Item.value) {
      const slotToElicit = 'Item';
      const speechOutput = 'What is the item to be found?';
      const repromptSpeech = 'Please tell me the name of the item to be found';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    } else if (slots.Item.confirmationStatus !== 'CONFIRMED') {
      if (slots.Item.confirmationStatus !== 'DENIED') {
        // slot status: unconfirmed
        const slotToConfirm = 'Item';
        const speechOutput = `The name of the item is ${slots.Item.value}, correct?`;
        const repromptSpeech = speechOutput;
        return this.emit(':confirmSlot', slotToConfirm, speechOutput, repromptSpeech);
      }

      const slotToElicit = 'Item';
      const speechOutput = 'What is the item you would like to find?';
      const repromptSpeech = 'Please tell me the name of the item to be found';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    }

    const itemName = slots.ItemName.value;
    let searchFlag = false;
    let requiredSynonyms = [];

    //search in activeList with itemName
    for (let activeMember in activeList) {
      if(activeMember[itemName]) {
        emitCopy(":tell", `your ${itemName} is located at ${activeMember[itemName]}`);
        searchFlag = true;
        break;
      }
    }
    //search in activeList with synonym
    if(!searchFlag) {
      console.log('Attempting to read data of synonyms in activeList');
      const synonyms = thesaurus.search(itemName).synonyms;
      //todo: filter out required synonyms
      requiredSynonyms = filterSynonyms(synonyms);
      requiredSynonyms.forEach(function (synonym) {
        for (let activeMember in activeList) {
          if(activeMember[synonym]) {
            //todo: user has to confirm that this is what he requires, setup dialog model
            emitCopy(":tell", `your ${synonym} is located at ${activeMember[synonym]}`);
            searchFlag = true;
            break;
          }
        }
      });
    }
    //search in Items table using ItemName
    if(!searchFlag) {
      console.log('Attempting to read data in Items table');
      let params = {
        TableName: itemsTableName,
        Key:{
          "itemName-userId": slots.Item.value + "-" + userId
        }
      };
      documentClient.get(params, function(err, data) {
        if (err) {
          console.error("Unable to find item. Error JSON:", JSON.stringify(err, null, 2));
          emitCopy(':tell', `oops! something went wrong`);
        } else {
          console.log("Found item:", JSON.stringify(data, null, 2));
          if(data.Item) {
            emitCopy(":tell", `you can find your ${data.Item.itemName} at ${data.Item.locationName}`)
          } else {
            //search in Items table on the basis of synonym
            console.log('Attempting to read data of synonyms in Items table');
            requiredSynonyms.forEach(function (synonym) {
              params.Key = {
                "itemName-userId": synonym + "-" + userId
              };
              documentClient.get(params, function(err, data) {
                if(err) {
                  console.error("Unable to find item. Error JSON:", JSON.stringify(err, null, 2));
                  emitCopy(':tell', `oops! something went wrong`);
                } else {
                  if(data.Item) {
                    emitCopy(":tell", `you can find your ${data.Item.itemName} at ${data.Item.locationName}`)
                  } else {
                    //todo: now check history @shikhar and @prakriti
                  }
                }
              });
            });

          }
        }
      });
    }
  },

  'AMAZON.CancelIntent': function () {
    const { userId } = this.event.session.user;
    storeActiveList(userId);
  },

  'AMAZON.StopIntent': function () {
    const { userId } = this.event.session.user;
    storeActiveList(userId);
  },

  'LaunchRequest':  function () {
    //todo: ask Shikhar or Prakriti to design this
    // Prakriti had already used this in one of her PR's
  },
  
  'StoreItemIntent': function () {
    const { userId } = this.event.session.user;
    const { slots } = this.event.request.intent;

    //fetch activeList if not yet
    if(!activeListFetchedStatus) {
      fetchActiveListAndCache(userId);
    }

    // name of the item
    if (!slots.Item.value) {
      const slotToElicit = 'Item';
      const speechOutput = 'What is the item to be stored?';
      const repromptSpeech = 'Please tell me the name of the item';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    } else if (slots.Item.confirmationStatus !== 'CONFIRMED') {
      if (slots.Item.confirmationStatus !== 'DENIED') {
        // slot status: unconfirmed
        const slotToConfirm = 'Item';
        const speechOutput = `The name of the item is ${slots.Item.value}, correct?`;
        const repromptSpeech = speechOutput;
        return this.emit(':confirmSlot', slotToConfirm, speechOutput, repromptSpeech);
      }
      
      const slotToElicit = 'Item';
      const speechOutput = 'What is the item you would like to store?';
      const repromptSpeech = 'Please tell me the name of the item';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    }
    
    //name of the place where the item is to be stored
    if (!slots.Place.value) {
      const slotToElicit = 'Place';
      const speechOutput = 'Where is the item stored?';
      const repromptSpeech = 'Please give me a location of the item.';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    } else if (slots.Place.confirmationStatus !== 'CONFIRMED') {
      if (slots.Place.confirmationStatus !== 'DENIED') {
        // slot status: unconfirmed
        const slotToConfirm = 'Place';
        const speechOutput = `The item location is ${slots.Place.value}, correct?`;
        const repromptSpeech = speechOutput;
        return this.emit(':confirmSlot', slotToConfirm, speechOutput, repromptSpeech);
      }
      
      // slot status: denied -> reprompt for slot data
      const slotToElicit = 'Place';
      const speechOutput = 'Where can the item be found?';
      const repromptSpeech = 'Please give me a location where the item is stored.';
      return this.emit(':elicitSlot', slotToElicit, speechOutput, repromptSpeech);
    }
    activeList.push({
      itemName: slots.Item.value,
      locationName: slots.Place.value
    });
    if(activeList.length > 10) {
      moveFromActiveListToDB(userId, activeList.shift());
    }
    this.emit(":tell", `your ${slots.Item.value} has been stored at ${slots.Place.value}`)
  }
};

exports.handler = function (event, context, callback) {
  const alexa = Alexa.handler(event, context, callback);
  alexa.registerHandlers(handlers);
  alexa.execute();
};
