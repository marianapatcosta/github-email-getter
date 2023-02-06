const container = document.getElementById('container')
const searchEmailForm = document.getElementById('search-email-form')
const gitHubNameInput = document.getElementById('github-name-input')
const searchResult = document.getElementById('search-result')

const GITHUB_USER_BASE_URL = 'https://api.github.com/users'
const RESULTS_PER_PAGE = 100
const DEFAULT_RESULTS_PAGE = 1

let currentPage = DEFAULT_RESULTS_PAGE

const getGitHubUserUrl = (username) => `${GITHUB_USER_BASE_URL}/${username}`

const getGitHubUserLastEventsUrl = (username) =>
  `${getGitHubUserUrl(username)}/events/public?per_page=${RESULTS_PER_PAGE}`

const getGitHubUserReposUrl = (username) =>
  `${getGitHubUserUrl(username)}/repos?per_page=${RESULTS_PER_PAGE}`

const isEmail = (url) => {
  const emailRegex =
    /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/
  return emailRegex.test(url)
}

const isGitHubNoReplyEmail = (url) => {
  const emailRegex = /.*\@users.noreply.github.com$/
  return emailRegex.test(url)
}

const isUrl = (url) => {
  const urlRegex = /^(http|https):\/\//
  return urlRegex.test(url)
}

const isGitHubUrl = (url) => {
  const urlRegex = /^((http|https):\/\/)?github.com\/(.*\S).*$/
  return urlRegex.test(url)
}

const getGitHubUsername = (url) =>
  url.split('github.com/')[1].split('/')[0].split('?')[0]

const populateGitHubUsernameInput = () => {
  chrome.tabs.query(
    {
      active: true,
      windowType: 'normal',
      currentWindow: true,
    },
    (tabs) => {
      const tabUrl = tabs[0].url
      if (isGitHubUrl(tabUrl)) {
        gitHubNameInput.value = getGitHubUsername(tabUrl)
      }
    }
  )
}

const searchGithubEmail = async (event) => {
  event.preventDefault()
  searchResult.innerHTML = ''
  const input = gitHubNameInput.value.trim().toLowerCase()

  if (!input) {
    return alert("Please enter a valid GitHub's username or URL")
  }

  const isValidUrl = isUrl(input)

  if (isValidUrl && !isGitHubUrl(input)) {
    return alert("Please enter a valid GitHub's username or URL")
  }

  const gitHubUsername = isValidUrl ? getGitHubUsername(input) : input

  try {
    renderSpinner()
    updateDisabledFormStatus(true)
    const userDataResponse = await fetch(getGitHubUserUrl(gitHubUsername))

    if (!userDataResponse.ok) {
      return handleError(userDataResponse)
    }

    const userData = await userDataResponse.json()

    if (isEmail(userData.email) && !isGitHubNoReplyEmail(email)) {
      renderEmail(userData.email)
      return
    }

    currentPage = DEFAULT_RESULTS_PAGE
    await getEmailFromRepos(gitHubUsername)
  } catch (error) {
    handleError(error)
  }
}

// This function is not used anymore because the author of PushEvent might not be the commit3ere author
const getEmailFromEvents = async (gitHubUsername) => {
  try {
    const userEventsResponse = await fetch(
      `${getGitHubUserLastEventsUrl(gitHubUsername)}&page=${currentPage}`
    )
    if (!userEventsResponse.ok) {
      return handleError(userEventsResponse)
    }

    const userEvents = await userEventsResponse.json()
    for (const event of userEvents) {
      if (
        event.type !== 'PushEvent' ||
        event.actor.login.toLowerCase() !== gitHubUsername
      ) {
        continue
      }

      const commits = event.payload.commits
      for (const {
        author: { email },
      } of commits) {
        if (isEmail(email) && !isGitHubNoReplyEmail(email)) {
          renderEmail(email)

          return
        }
      }
    }
    if (userEvents.length < RESULTS_PER_PAGE) {
      currentPage = DEFAULT_RESULTS_PAGE
      getEmailFromRepos(gitHubUsername)
      return
    }
    currentPage = currentPage + 1
    getEmailFromEvents(gitHubUsername)
  } catch (error) {
    handleError(error)
  }
}

const getEmailFromRepos = async (gitHubUsername) => {
  try {
    const userReposResponse = await fetch(
      `${getGitHubUserReposUrl(gitHubUsername)}&page=${currentPage}`
    )

    if (!userReposResponse.ok) {
      return handleError(userReposResponse)
    }

    const userRepos = await userReposResponse.json()

    for (const repo of userRepos) {
      // TODO: check all the commits (not only the first 100)
      const commitUrl = `${repo.commits_url.split('{/sha}')[0]}?per_page=100`
      try {
        const commitsResponse = await fetch(commitUrl)

        if (!commitsResponse.ok) {
          handleError(commitsResponse, true)
          continue
        }

        const commits = await commitsResponse.json()
        for (const { commit, author } of commits) {
          if (
            author?.login.toLowerCase() === gitHubUsername &&
            isEmail(commit?.author?.email) &&
            !isGitHubNoReplyEmail(commit?.author?.email)
          ) {
            renderEmail(commit.author.email)
            return
          }
        }
      } catch (error) {
        handleError(error, true)
        continue
      }
    }
    if (userRepos.length < RESULTS_PER_PAGE) {
      renderEmail('')
      return
    }
    currentPage = currentPage + 1
    getEmailFromRepos(gitHubUsername)
  } catch (error) {
    handleError(error)
  }
}

const handleError = (errorResponse, isToContinue = false) => {
  let alertMessage = 'An error occurred!'
  if (errorResponse?.status === 404) {
    alertMessage = 'The username you provide does not exist.'
  }

  if (
    errorResponse?.status === 403 &&
    Number(errorResponse?.headers.get(['x-ratelimit-remaining'])) === 0
  ) {
    const tryAgainDate = new Date(
      Number(errorResponse?.headers.get(['x-ratelimit-reset'])) * 1000
    ).toLocaleTimeString()
    alertMessage = `You reach the rate limit for GitHub API requests. Please try again after ${tryAgainDate}.`
  }

  if (!isToContinue) {
    alert(alertMessage)
    removeSpinner()
    updateDisabledFormStatus(false)
    console.error(errorResponse)
  }
}

const copyEmailClipboard = async (email) => {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      alert('Copy to clipboard is not available in this browser.')
    }
    navigator.clipboard.writeText(email)
  } catch (error) {
    alert('An error occurred!')
    console.error(error)
  }
}

const updateDisabledFormStatus = (newDisabledStatus) => {
  for (const element of searchEmailForm.elements) {
    element.disabled = newDisabledStatus
  }
}

const renderSpinner = () => {
  const div = document.createElement('div')
  div.innerHTML = '<i class="fas fa-spinner fa-pulse"></i>'
  div.classList.add('spinner')

  container.appendChild(div)
}

const removeSpinner = () => {
  const [spinner] = document.getElementsByClassName('spinner')
  spinner.parentNode.removeChild(spinner)
}

const renderEmail = (email) => {
  removeSpinner()
  updateDisabledFormStatus(false)

  if (!email) {
    searchResult.innerHTML =
      '<i class="fa-regular fa-face-sad-tear"></i><p>Sorry, e-mail not found for this user.<i class="fa-solid fa-ban"></i</p>'
    return
  }

  const div = document.createElement('div')
  const h2 = document.createElement('h2')
  h2.innerHTML = 'Email found! <i class="fa-regular fa-check-circle"></i>'

  const p = document.createElement('p')
  p.innerText = email

  const copyButton = document.createElement('button')
  copyButton.innerHTML = '<i class="fa-regular fa-copy"></i>'
  copyButton.title = `Copy ${email} to clipboard`
  copyButton.setAttribute('aria-label', `Click to copy ${email} to clipboard.`)
  copyButton.addEventListener('click', () => copyEmailClipboard(email))

  div.appendChild(p)
  div.appendChild(copyButton)

  searchResult.appendChild(h2)
  searchResult.appendChild(div)
}

searchEmailForm.addEventListener('submit', searchGithubEmail)
populateGitHubUsernameInput()
