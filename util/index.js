const sleepTimeout = process.env.SLEEP_TIMEOUT || 5000;

const parseSparqlResults = (data) => {
  const vars = data.head.vars;
  return data.results.bindings.map(binding => {
    let obj = {};
    vars.forEach(varKey => {
      if (binding[varKey]) {
        obj[varKey] = binding[varKey].value;
      }
    });
    return obj;
  })
};

function sleep() {
  return new Promise((resolve) => {
    setTimeout(resolve, sleepTimeout);
  });
}

/* Util to reserve the service to avoid concurrency */
let serviceBusy = false;
function checkServiceBusy() {
  if (serviceBusy) {
    let error = new Error('Agenda service is busy. Please refresh and try again later');
    error.status = 500;
    throw error;
  }
}
function setServiceBusy(value) {
  serviceBusy = value;
}

export {
  parseSparqlResults,
  sleep,
  checkServiceBusy,
  setServiceBusy
};
